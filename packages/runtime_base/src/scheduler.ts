
/**
 * 调度要达到的目的: 1. 分 loop 批量执行任务 2. 限制每个任务执行的时长，
 *                防止某个任务长时间执行阻塞主线程 3. 按照任务优先级
 *                优先执行优先级更高的其他任务 4. 根据之前暂停任务的
 *                优先级，在适当的时机重新恢复该任务的执行，一旦再次执行
 *                时间过长，重复步骤 2
 * Job 特性: 延迟执行，过期时间，优先级，Job 一旦开始执行就必须执行完，
 *          任务自身不能中断，除非通过传入的任务控制器由任务内部手动
 *          进行暂停、恢复
 *          任务并非注册之后就马上执行，而是需要等到 js 执行栈同步逻辑
 *          全部执行完毕，再统一批量执行队列中存储的任务
 * options: 任务执行期间是否支持动态插入新的任务？
 *          任务是否支持自我控制？
 *          任务的 hooks
 * 通常一次非常庞大的 patch 操作会作为一个任务，但是这样会导致任务一旦执行
 * 就无法停止，因此可以以 dom 节点为粒度将一个大任务拆分成一连串的单节点
 * 渲染小任务，这样单个节点渲染任务执行时不会长时间执行，这样连续的渲染任务
 * 可以在中间暂停执行，当需要恢复渲染时，再从之前断掉的节点继续执行后面的渲染任务
 * dom 渲染任务是深度优先渲染，这样才能保证最早将一个 dom 节点完整的渲染出来
 */

import {
  isNumber,
  MAX_INT,
  isFunction,
  EMPTY_OBJ,
  deleteProperty,
  hasOwn,
  isBoolean,
  extend,
  NO,
  isObject
} from "../../share/src"
import { ListAccessor } from "../../share/src/shareTypes"

export interface JobHooks {
  onCompleted?: Function
}

export interface Job<T = any> {
  (...args: any[]): T | Job | void
}

export interface SnapshotNode {
  content: Job
  next: SnapshotNode
}

// 任务宿主节点
export interface JobNode {
  // data
  job: Job // 当前任务
  originalJob: Job // 该宿主对应的初始任务
  id?: number | string
  priority?: number
  birth?: number
  startTime?: number
  timeout?: number
  expirationTime?: number
  delay?: number
  isExpired?: boolean
  convergentable?: boolean
  type?: number
  hooks?: JobHooks
  scopedSnapshot?: ListAccessor<SnapshotNode> // 当前任务节点的子任务快照，测试环境可为祖先任务创建子任务的快照用于调度分析

  // pointers
  previous: JobNode | JobNode
  next: JobNode | JobNode
}

export const enum JobListTypes {
  JOB_LIST = 0,
  BACKUP_LIST = 1
}

export const enum SchedulerFlags {
  JOB_ID_BASE = '__n_Job'
}

export const enum JobPriorities {
  INVALID = -1, // 无效优先级
  IMMEDIATE = 0, // 立即执行
  HIGH = 1, // 高优先级，如用户交互性事件
  NORMAL = 2, // 正常优先级，默认值
  LOW = 3, // 低优先级
  IDLE = 4 // 闲置优先级，永远不会过期
}

// 任务节点所属队列类型
export const enum JobNodeTypes {
  MAIN = 0,
  BACKUP = 1
}

export const JobTimeouts = {
  INVALID: MAX_INT, // 无效优先级
  IMMEDIATE: -1, // 立即执行
  HIGH: 50, // 高优先级，如用户交互性事件
  NORMAL: 100, // 正常优先级，默认值
  LOW: 150, // 低优先级
  IDLE: MAX_INT // 闲置优先级，永远不会过期
}

// scheduler 全局配置
export interface SchedulerOptions {
  allowInsertion?: boolean // 当任务中断执行时是否允许任务中间插入新的任务
  expireStrategy?: number // 过期任务的处理策略
  openSnapshot?: boolean // 是否开启任务单元执行快照

  // hooks
  onConvergentJobsStarted?: Function // 可收敛任务开始执行时的 hook
  onConvergentJobsFinished?: Function // 一批可收敛任务执行完毕时触发的 hook
}

export interface JobOptions {
  convergentable?: boolean // 任务为可收敛的，相邻可收敛任务可收敛为一个连续执行的任务，因此任务之间不支持中断
  hooks?: JobHooks // hooks
}

// 过期任务处理策略
export const enum ExpireStrategies {
  INVOKE_IMMEDIATELY = 0, // 过期任务不移出执行队列，保持正常执行
  IDLE = 1, // 执行队列空闲时批量执行过期任务、剩余备选任务
  INVALID = 2 // 过期任务作为垃圾任务被抛弃，之后将不会再有执行机会
}

export const enum MacrotaskTypes {
  TIMEOUT = 0, // setTimeout
  BROADCAST = 1 // port postMessage
}

let schedulerContext: SchedulerContext

export interface SchedulerContext {
  // scheduler configs
  allowInsertion: boolean
  expireStrategy: number
  openSnapshot: boolean

  // global hooks
  onConvergentJobsStarted: Function
  onConvergentJobsFinished: Function

  id: number
  // 每帧的时间片单元，是每帧时间内用来执行 js 逻辑的最长时长，任务
  // 连续执行超过时间片单元，就需要中断执行把主线程让给优先级更高的任务
  // 比如说渲染工作
  timeUnit: number
  // 当前任务执行 loop 截止时间
  deadline: number | void;
  // 任务 loop 处于 pending 阶段，积累执行队列中的任务
  isLoopPending: boolean
  // 任务 loop 是否处于 running 阶段，批量执行执行队列中的任务
  isLoopRunning: boolean
  // 任务 loop 是否可执行
  isLoopValid: boolean
  currentJobNode: JobNode // 当前执行的任务节点
  hasUncompletedJobWhenLoopFinished: boolean // 当前 loop 结束时存在未完成的任务

  // 任务队列中任务对应的缓存，仅用于存储注册时作为执行任务的任务对应的缓存信息: job -> jobNode
  jobCache: WeakMap<Job, JobNode>

  // 任务队列使用链表的原因: 插入任务只需要查找和 1 次插入的开销，
  // 如果使用数组这种连续存储结构，需要查找和移动元素的开销
  // 执行队列
  jobListRoot: JobNode
  // 备选任务执行队列
  backupListRoot: JobNode
}

/**
 * 初始化 scheduler
 * @param param
 */
export function initScheduler({
  allowInsertion: a,
  expireStrategy: e,
  openSnapshot: o,
  onConvergentJobsStarted: cjs,
  onConvergentJobsFinished: cjf
}: SchedulerOptions): SchedulerContext {
  return (schedulerContext = {
    // scheduler configs
    allowInsertion: isBoolean(a) ? a : false,
    expireStrategy: isNumber(e) ? e : ExpireStrategies.INVOKE_IMMEDIATELY,
    openSnapshot: __DEV__ ? (isBoolean(o) ? o : true) : false,

    // global hooks
    onConvergentJobsStarted: cjs || NO,
    onConvergentJobsFinished: cjf || NO,

    id: 0,
    // 每帧的时间片单元，是每帧时间内用来执行 js 逻辑的最长时长，任务
    // 连续执行超过时间片单元，就需要中断执行把主线程让给优先级更高的任务
    // 比如说渲染工作
    timeUnit: 8,
    // 当前任务执行 loop 截止时间
    deadline: -1,
    // 任务 loop 处于 pending 阶段，积累执行队列中的任务
    isLoopPending: false,
    // 任务 loop 是否处于 running 阶段，批量执行执行队列中的任务
    isLoopRunning: false,
    // 任务 loop 是否可执行
    isLoopValid: true,
    currentJobNode: null, // 当前执行的任务节点
    hasUncompletedJobWhenLoopFinished: false, // 当前 loop 结束时存在未完成的任务

    // 任务队列中任务对应的缓存，仅用于存储注册时作为执行任务的任务对应的缓存信息: job -> jobNode
    jobCache: new WeakMap(),

    // 任务队列使用链表的原因: 插入任务只需要查找和 1 次插入的开销，
    // 如果使用数组这种连续存储结构，需要查找和移动元素的开销
    // 执行队列
    jobListRoot: null,
    // 备选任务执行队列
    backupListRoot: null
  })
}

export function genCurrentTime(): number {
  return new Date().getTime()
}

/**
 * 向调度系统注册任务
 * 调度系统允许任务本身执行时注册新的任务，由于一个执行 loop 内是同步执行任务的，
 * 因此每个被执行的任务都能彻底执行完并出队，因此任务不会发生中断插入、重复执行，
 * 所以在 loop 内不需要考虑任务的重置与再执行问题
 * @param job 
 * @param priority 
 * @param timeout 
 * @param delay 
 * @param options
 */
export function registerJob(
  job: Job,
  priority: number = JobPriorities.NORMAL,
  timeout?: number,
  delay: number = 0,
  options: JobOptions = EMPTY_OBJ
): Job {
  // 任务 loop 执行过程中不允许注册新的任务，避免新的任务插队，插入父任务对应的子任务
  // 序列中，打断子任务之间的执行连续性。被打断连续执行的父任务虽然可以在插入任务执行完毕
  // 后重置为原始任务并完全重新执行，但这需要 loop 中执行每个任务前都要先检测任务是否被
  // 其他任务打断，这是比较消耗性能的，因此我们不会这么处理
  if (schedulerContext.isLoopRunning) {
    return
  }

  // 初始化任务的保质期
  if (!isNumber(timeout)) {
    switch (priority) {
      case JobPriorities.IMMEDIATE:
        timeout = JobTimeouts.IMMEDIATE
        break
      case JobPriorities.HIGH:
        timeout = JobTimeouts.HIGH
        break
      case JobPriorities.NORMAL:
        timeout = JobTimeouts.NORMAL
        break
      case JobPriorities.LOW:
        timeout = JobTimeouts.LOW
        break
      case JobPriorities.INVALID:
      case JobPriorities.IDLE:
        timeout = JobTimeouts.IDLE
        break
      default:
        timeout = JobTimeouts.NORMAL
    }
  }

  const birth: number = genCurrentTime() // 任务注册时间
  const startTime: number = birth + delay // 任务原本应该开始执行的时间
  const expirationTime: number = startTime + timeout // 任务过期时间

  const cache: JobNode = schedulerContext.jobCache.get(job)
  if (cache) {
    if (expirationTime < cache.expirationTime) {
      // 为已存在的任务节点提级
      cache.timeout = timeout
      cache.expirationTime = expirationTime
      if (cache.type === JobNodeTypes.MAIN) {
        // 如果缓存任务在主任务队列，则对该任务进行提级转移处理
        // 如果缓存任务在备选任务队列，则等待其进入主任务队列时计算其插入位置即可
        if (!isRootOfMain(cache, schedulerContext)) {
          // 非队头任务节点有提升排序的空间，将该任务节点向队列前方移动至合适的位置
          const anchor: JobNode = cache.previous
          removeJob(cache, schedulerContext)
          pushJobToMain(cache, schedulerContext, anchor)
        }
      }
    } else {
      // 新注册任务在调度队列中已存在，且不会插入到已有任务前面，则忽略该任务
      return null
    }
  } else {
    const jobNode: JobNode = createJobNode(
      job,
      birth,
      timeout,
      startTime,
      expirationTime,
      delay,
      schedulerContext,
      options
    )
    // 创建任务缓存
    schedulerContext.jobCache.set(job, jobNode)
    assignJob(jobNode, schedulerContext)
    return job
  }
}

/**
 * 调度系统的执行者
 * 返回值表示执行队列当前 loop 是否全部执行完毕，全部执行完毕
 * 返回 true，loop 中断则返回 false
 * 每个 loop 跑完后都会去后补任务队列中获取高优任务，然后在
 * 下个 loop 去执行。但是需要考虑一些延时较长的任务，在所有
 * loop 全部跑完后依然没有时机去添加到执行队列中，那么这些任务
 * 便没有了触发执行的时机
 * @param ctx
 */
export function flushJobs(ctx: SchedulerContext): boolean {
  const { jobListRoot } = ctx
  ctx.isLoopPending = false
  ctx.isLoopRunning = true

  checkLoop(jobListRoot, ctx)

  ctx.currentJobNode = head(jobListRoot)
  ctx.deadline = genCurrentTime() + ctx.timeUnit
  while (ctx.currentJobNode !== null && ctx.isLoopValid) {
    // invoke hook
    if (enterConvergence(ctx.currentJobNode)) {
      ctx.onConvergentJobsStarted()
    }

    const next: JobNode = handleJob(ctx.currentJobNode, ctx)

    if (exitConvergence(ctx.currentJobNode)) {
      ctx.onConvergentJobsFinished()
    }

    if (
      !needConvergeBackwards(ctx.currentJobNode) &&
      shouldYield(ctx)
    ) {
      // 当前 loop 执行中断结束，执行权让给高优先级的任务.
      // 将高优先级的任务添加到执行队列，然后在下一个 loop
      // 去恢复任务的批量执行
      fetchPriorJobs(ctx)
      requestRunLoop(ctx)
      ctx.isLoopRunning = false
      return false
    }

    ctx.currentJobNode = next
  }

  // 当前 loop 结束
  ctx.isLoopRunning = false
  ctx.hasUncompletedJobWhenLoopFinished = isJobToBeContinuous(ctx.currentJobNode)

  // 执行队列的任务全部执行完成，执行备选任务
  if (isListEmpty(jobListRoot)) {
    requestRunBackup(ctx)
  }

  return true
}

/**
 * 任务节点是未完待续的
 * @param jobNode 
 */
function isJobToBeContinuous(jobNode: JobNode): boolean {
  return jobNode.job !== null
}

/**
 * 任务是否可向后收敛
 * @param jobNode 
 */
function needConvergeBackwards(jobNode: JobNode): boolean {
  return (jobNode.convergentable && jobNode.next?.convergentable)
}

/**
 * 是否即将进入任务收敛阶段
 * @param jobNode 
 */
function enterConvergence(jobNode: JobNode): boolean {
  return (jobNode.convergentable && !jobNode.previous?.convergentable)
}

/**
 * 是否已退出任务收敛阶段
 * @param jobNode 
 */
function exitConvergence(jobNode: JobNode): boolean {
  return (jobNode.convergentable && !jobNode.next?.convergentable)
}

/**
 * 执行 loop 开始前的检查工作，如果 loop 首个任务为打断了上一个 loop
 * 未执行完的任务之间，需要将被插队的任务重置到初始宿主任务
 * @param jobRoot 
 */
export function checkLoop(jobRoot: JobNode, ctx: SchedulerContext): void {
  if (ctx.allowInsertion) {
    // 如果调度系统允许中断的任务被其他任务插队，则跳过 loop 检查
    return
  }

  const firstNode: JobNode = head(jobRoot)
  if (ctx.hasUncompletedJobWhenLoopFinished) {
    if (ctx.currentJobNode !== firstNode) {
      // 断开的任务前插队了其他高优任务，需要将被插队任务重置为初始任务
      resetJob(ctx.currentJobNode)
    }
  }
}

/**
 * 当执行队列为空时，检测备选队列，并触发备选队列任务的执行，
 * 并且不断重复该过程，直到两个队列中的任务全部被执行完毕
 */
export function requestRunBackup(ctx: SchedulerContext): void {
  const { jobListRoot, backupListRoot } = ctx
  const backupJobNode = head(ctx.backupListRoot)
  const currentTime = genCurrentTime()
  if (backupJobNode.startTime <= currentTime) {
    pushJobToMain(popJobOutOfBackup(ctx), ctx)
    requestRunLoop(ctx)
  } else {
    createMacrotask(
      flushBackup,
      [ctx],
      { delay: backupJobNode.startTime - currentTime }
    )
  }
}

/**
 * 执行备选任务队列
 * @param ctx 
 */
export function flushBackup(ctx: SchedulerContext) {
  pushJobToMain(popJobOutOfBackup(ctx), ctx)
  requestRunLoop(ctx)
}

/**
 * 获取备选任务队列中高优先级的任务，移动到执行队列中
 * 如何处理已过期任务？
 * 1. 过期任务根据任务的到期时间添加到执行队列，在下一个
 *    loop 执行；
 * 2. 过期任务在下一个 loop 开始前重新进行注册，作为全新的任务
 *    在下一个 loop 时进入到执行队列中；
 * 3. 过期任务不再进行后续处理，作为垃圾任务被丢弃掉
 */
export function fetchPriorJobs(ctx: SchedulerContext): void {
  let currentNode = head(ctx.backupListRoot)
  const currentTime = genCurrentTime()
  while (currentNode !== null) {
    if (currentNode.startTime <= currentTime) {
      // 备选任务到达开始执行时间，推入主执行队列等待下一 loop 执行
      pushJobToMain(popJobOutOfBackup(ctx), ctx)
    } else {
      break
    }
    currentNode = head(ctx.backupListRoot)
  }
}

/**
 * 处理任务节点
 * @param jobNode 
 * @param ctx
 */
export function handleJob(
  jobNode: JobNode,
  ctx: SchedulerContext
): JobNode {
  const isExpired = jobNode.expirationTime < genCurrentTime()
  if (!isExpired) {
    // 未过期任务处理
    // 任务如果返回子任务，说明该任务未执行完毕，后面还会
    // 继续执行，因此当前任务节点不出队，将子任务替换到当前
    // 任务节点上
    // 注意: 当前任务执行可能会触发全新任务的注册导致任务插入
    // 当前任务前方
    const childJob: Job = invokeJob(jobNode)
    if (childJob === null) {
      // 当前任务执行完毕，移出任务队列 (当前任务前可能插入新任务，因此不能直接 pop 任务宿主节点)
      removeJob(jobNode, ctx)
      if (isFunction(jobNode.hooks?.onCompleted)) {
        // 当前任务节点全部处理完毕，执行对应的 hook
        jobNode.hooks?.onCompleted()
      }
    }
  } else {
    // 过期任务处理
    switch (ctx.expireStrategy) {
      case ExpireStrategies.INVOKE_IMMEDIATELY:
        // 调度系统过期任务默认处理策略
        const childJob: Job = invokeJob(jobNode, isExpired)
        if (childJob === null) {
          removeJob(jobNode, ctx)
          if (isFunction(jobNode.hooks?.onCompleted)) {
            // 当前任务节点全部处理完毕，执行对应的 hook
            jobNode.hooks?.onCompleted()
          }
        }
        break
      case ExpireStrategies.INVALID:
        // 过期任务被视为无效任务，直接从执行队列移除
        popJobOutOfMain(ctx)
        break
      case ExpireStrategies.IDLE:
        // 过期任务的优先级降级为最低的空闲等级
        downgradeToIdle(jobNode, ctx)
        break
    }
  }

  return head(ctx.jobListRoot)
}

/**
 * 将任务转换成 idle 等级任务，idle 等级任务永远不会过期，
 * 将会在执行队列空闲时再执行
 * @param job 
 */
export function downgradeToIdle(jobNode: JobNode, ctx: SchedulerContext): void {
  jobNode.priority = JobPriorities.IDLE
  jobNode.timeout = JobTimeouts.IDLE
  jobNode.expirationTime = jobNode.startTime + JobTimeouts.IDLE
  // 将降级为最低优先级的任务移动至主任务队列尾部
  pushJobToMain(popJobOutOfMain(ctx), ctx)
}

export function head(root: JobNode): JobNode {
  return root
}

export function shouldYield(ctx: SchedulerContext) {
  const currentTime = genCurrentTime()
  return currentTime >= ctx.deadline
}

/**
 * 执行单个任务，返回有效子任务，说明当前任务未执行完，任务不出队；
 * 否则表示该任务已执行完毕，需要做出队操作
 * @param jobNode 
 * @param jobArgs 
 */
export function invokeJob(jobNode: JobNode, ...jobArgs: any[]): Job | null {
  const job = jobNode.job
  if (isFunction(job)) {
    const childJob: Job | void = job(...jobArgs)

    // 将当前已执行完的子任务添加进快照
    cacheJobSnapshot(job, jobNode)

    if (isFunction(childJob)) {
      // 子任务作为新任务重新注册入队
      registerJob(childJob)
      return null
    }
    
    // 无子任务
    return null
  }

  return null
}

/**
 * 将已执行的任务作为快照缓存至宿主节点的快照队列里
 * @param job 
 * @param container 
 */
export function cacheJobSnapshot(job: Job, container: JobNode): Job {
  const snapshots = container.scopedSnapshot
  const snapshot = { content: job, next: null }
  if (snapshots) {
    snapshots.last = snapshots.last.next = snapshot
  } else {
    container.scopedSnapshot = {
      first: snapshot,
      last: snapshot
    }
  }

  return job
}

/**
 * 任务执行暂停
 */
export function pause(ctx: SchedulerContext): void {
  ctx.isLoopValid = false
}

/**
 * 任务执行恢复
 */
export function resume(ctx: SchedulerContext): void {
  ctx.isLoopValid = true
}

/**
 * 取消任务
 * @param jobNode 
 */
export function cancelJob(jobNode: JobNode): void {
  jobNode.job = null
}

/**
 * 重置任务: 将任务节点挂载的任务重置为初始宿主任务
 * @param jobNode 
 */
export function resetJob(jobNode: JobNode): void {
  // todo 已取消的任务对应的 renderPayload 缓存信息需要清除掉
  jobNode.job = jobNode.originalJob
}

/**
 * 任务编排与任务执行触发
 * @param job 
 */
export function assignJob(jobNode: JobNode, ctx: SchedulerContext) {
  if (!jobNode.delay) {
    // 非延时任务
    pushJobToMain(jobNode, ctx)
    requestRunLoop(ctx)
  } else {
    // 延时任务 (备选任务的一种)
    pushJobToBackup(jobNode, ctx)
  }
}

/**
 * 请求开启一个任务执行 loop
 */
export function requestRunLoop(ctx: SchedulerContext) {
  if (!ctx.isLoopPending) {
    createMacrotask(flushJobs, [ctx])
    ctx.isLoopPending = true
  }
}

/**
 * 生成一个宏任务，不同环境生产出的宏任务有可能有差异性
 * 为什么使用宏任务，原因是浏览器主线程每一个 event loop
 * 是这样运行的:
 * 运行 js 宏任务 -> 执行微任务 -> 布局计算 layout 及
 * 渲染工作 -> 进入下一个 event loop，执行宏任务
 * 宏任务是在渲染执行完之后才会执行，这样能够保证在下一轮
 * 任务执行前，浏览器能够有时间去做渲染工作
 * @param task 
 * @param taskArgs 
 * @param options 
 */
export function createMacrotask(
  task: Function,
  taskArgs: any[],
  options: Record<string, any> = EMPTY_OBJ
): number | void {
  const { type = MacrotaskTypes.TIMEOUT } = options
  switch (type) {
    case MacrotaskTypes.TIMEOUT:
      return setTimeout(task, options.delay, ...taskArgs)
    case MacrotaskTypes.BROADCAST:
      // TODO 注册广播形式的宏任务，待实现
      return null
    default:
      // do nothing
      return null
  }
}

/**
 * 创建任务节点
 * @param job 
 * @param type 
 * @param previous 
 * @param next 
 */
export function createJobNode(
  job: Job,
  birth: number,
  timeout: number,
  startTime: number,
  expirationTime: number,
  delay: number,
  ctx: SchedulerContext,
  options: JobOptions
): JobNode {
  return {
    id: `${SchedulerFlags.JOB_ID_BASE}${ctx.id++}`,
    job,
    birth,
    timeout,
    startTime,
    expirationTime,
    delay,
    previous: null,
    next: null,
    originalJob: job,
    ...options
  }
}

/**
 * 任务节点是否为主任务队列的根节点
 * @param jobNode 
 * @param ctx 
 */
export function isRootOfMain(jobNode: JobNode, ctx: SchedulerContext): boolean {
  return jobNode === ctx.jobListRoot
}

/**
 * 任务节点是否为备选任务队列的根节点
 * @param jobNode 
 * @param ctx 
 */
export function isRootOfBackup(jobNode: JobNode, ctx: SchedulerContext): boolean {
  return jobNode === ctx.backupListRoot
}

/**
 * 任务进入主队列，构建最小堆任务队列
 * 按照 scheduler 默认编排策略进行任务编排
 * 从队列尾部向前遍历进行任务插入，因为相同优先级的任务一定是
 * 后注册的靠近队尾，尾部向前遍历在大部分 case 下都能用最少的遍历次数找到
 * 任务的目标插入位置
 * 队列为空
 * 可指定用于插入位置计算的起始位置锚点
 * @param jobNode 
 * @param ctx 
 * @param anchor
 */
export function pushJobToMain(
  jobNode: JobNode,
  ctx: SchedulerContext,
  anchor?: JobNode
): boolean {
  if (!ctx.jobListRoot) {
    // 创建双向循环链表
    ctx.jobListRoot = jobNode
    jobNode.previous = jobNode.next = jobNode
    return true
  }

  const lastNode: JobNode = anchor || ctx.jobListRoot.previous
  let currentNode: JobNode = lastNode
  while (currentNode !== null && !isRootOfMain(currentNode, ctx)) {
    if (jobNode.expirationTime >= currentNode.expirationTime) {
      jobNode.previous = currentNode
      jobNode.next = currentNode.next
      currentNode.next = currentNode.next.previous = jobNode
      jobNode.type = JobNodeTypes.MAIN
      return true
    }
    currentNode = currentNode.previous
  }

  return true
}

/**
 * 任务进入备选队列，构建最小堆任务队列
 * 按照 scheduler 默认编排策略进行任务编排
 * 从队列尾部向前遍历进行任务插入，因为相同优先级的任务一定是
 * 后注册的靠近队尾，尾部向前遍历在大部分 case 下都能用最少的遍历次数找到
 * 任务的目标插入位置
 * 队列为空
 * @param jobNode 
 * @param ctx 
 */
export function pushJobToBackup(
  jobNode: JobNode,
  ctx: SchedulerContext
): boolean {
  if (!ctx.backupListRoot) {
    // 创建双向循环链表
    ctx.backupListRoot = jobNode
    jobNode.previous = jobNode.next = jobNode
    return true
  }

  const lastNode: JobNode = ctx.backupListRoot.previous
  let currentNode: JobNode = lastNode
  while (currentNode !== null && !isRootOfBackup(currentNode, ctx)) {
    if (jobNode.startTime >= currentNode.startTime) {
      jobNode.previous = currentNode
      jobNode.next = currentNode.next
      currentNode.next = currentNode.next.previous = jobNode
      jobNode.type = JobNodeTypes.BACKUP
      return true
    }
    currentNode = currentNode.previous
  }

  return true
}

/**
 * 队头任务移出主队列
 * @param ctx
 */
export function popJobOutOfMain(
  ctx: SchedulerContext
): JobNode {
  const { jobListRoot: root } = ctx
  root.previous.next = root.next
  root.next.previous = root.previous
  ctx.jobListRoot = root.next
  // 任务永久出队，清除对应的任务缓存
  ctx.jobCache.delete(root.originalJob)
  return root
}

/**
 * 队头任务移出备选队列
 * @param ctx
 */
export function popJobOutOfBackup(
  ctx: SchedulerContext
): JobNode {
  const { backupListRoot: root } = ctx
  root.previous.next = root.next
  root.next.previous = root.previous
  ctx.jobListRoot = root.next
  // 任务永久出队，清除对应的任务缓存
  ctx.jobCache.delete(root.originalJob)
  return root
}

/**
 * 移除任务
 * @param job 
 * @param jobRoot 
 */
export function removeJob(jobNode: JobNode, ctx: SchedulerContext): void {
  const prev: JobNode = jobNode.previous
  const next: JobNode = jobNode.next
  prev.next = next
  if (next) {
    next.previous = prev
  }

  // 清除任务缓存信息
  ctx.jobCache.delete(jobNode.originalJob)
}

/**
 * 任务反注册，从调度系统中对应任务队列移出
 * 调度系统对外暴露 API
 * @param job
 */
export function unregisterJob(job: Job): boolean {
  const jobContainer: JobNode = schedulerContext.jobCache.get(job)
  if (jobContainer) {
    removeJob(jobContainer, schedulerContext)
    return true
  } else {
    return false
  }
}

/**
 * 目标队列是否为空
 * @param listRoot 
 */
export function isListEmpty(listRoot: JobNode) {
  return !head(listRoot)
}
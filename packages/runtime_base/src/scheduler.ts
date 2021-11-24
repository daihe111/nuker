import {
  isNumber,
  MAX_INT,
  isFunction,
  EMPTY_OBJ,
  deleteProperty,
  hasOwn,
  genBaseListNode,
  createEmptyObject,
  extend
} from "../../share/src"

export interface JobHooks {
  onCompleted?: Function
}

export interface Job<T = any> {
  (...args: any[]): T | Job | void
  id?: number | string
  controller?: JobControllers
  priority?: number
  birth?: number
  startTime?: number
  timeout?: number
  expirationTime?: number
  delay?: number
  isExpired?: boolean
  // 当前任务节点的子任务快照，测试环境可为祖先任务创建
  // 子任务的快照用于调度分析
  scopedSnapshot?: JobNode | null
  hooks?: JobHooks
  options?: JobOptions
}

export interface JobNode {
  job: Job
  previous: JobNode
  next: JobNode
  isRoot?: boolean
  type?: number | string
  hooks?: JobHooks
}

export const enum JobListTypes {
  JOB_LIST = 0,
  BACKUP_LIST = 1
}

export const enum RegisterModes {
  DEFAULT_ORDER = 0, // 任务按照默认顺序注册，即按照过期时间进行排序注册
  AFTER_BLASTING_JOB = 1 // 注册到正在执行任务的后方
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

export const JobTimeouts = {
  INVALID: MAX_INT, // 无效优先级
  IMMEDIATE: -1, // 立即执行
  HIGH: 50, // 高优先级，如用户交互性事件
  NORMAL: 100, // 正常优先级，默认值
  LOW: 150, // 低优先级
  IDLE: MAX_INT // 闲置优先级，永远不会过期
}

export interface JobOptions {
  isDeepFirst?: boolean // 任务执行是否遵循深度优先规则
  expireStrategy?: number // 过期任务的处理策略
  openSnapshot?: boolean // 是否开启任务单元执行快照
  hooks?: JobHooks
}

// 任务控制器
export interface JobControllers {
  pause?: Function
  resume?: Function
  cancel?: Function
}

// 过期任务处理策略
export const enum ExpireStrategies {
  DEFAULT = 0, // 过期任务不移出执行队列，保持正常执行
  REUSE = 1, // 过期任务在不同的任务执行 loop 中可复用，按照过期时间排序可再次插入执行队列
  REBIRTH = 2, // 过期任务需要重生，作为新的任务插入执行队列
  IDLE = 3, // 执行队列空闲时批量执行过期任务、剩余备选任务
  INVALID = 4 // 过期任务作为垃圾任务被抛弃，之后将不会再有执行机会
}

export const enum MacrotaskTypes {
  TIMEOUT = 0, // setTimeout
  BROADCAST = 1 // port postMessage
}

const jobContentKey: string = 'job'
let id = 0
// 每帧的时间片单元，是每帧时间内用来执行 js 逻辑的最长时长，任务
// 连续执行超过时间片单元，就需要中断执行把主线程让给优先级更高的任务
// 比如说渲染工作
const timeUnit = 8
// 当前任务执行 loop 截止时间
let deadline: number | void;
// 任务 loop 处于 pending 阶段，积累执行队列中的任务
let isLoopPending = false
// 任务 loop 是否处于 running 阶段，批量执行执行队列中的任务
let isLoopRunning = false
// 任务 loop 是否可执行
let isLoopValid = true
let timer: number | void
let currentJobNode: JobNode

// 任务队列使用链表的原因: 插入任务只需要查找和 1 次插入的开销，
// 如果使用数组这种连续存储结构，需要查找和移动元素的开销
// 执行队列
const jobListRoot: JobNode = initJobList(null, JobListTypes.JOB_LIST)
// 备选任务执行队列
const backupListRoot: JobNode = initJobList(null, JobListTypes.BACKUP_LIST)

// 初始化任务队列
function initJobList(job: Job, type: number): JobNode {
  const jobRoot: JobNode = {
    isRoot: true,
    ...createJobNode(null, type)
  }
  jobRoot.previous = jobRoot.next = jobRoot
  return jobRoot
}

export function genCurrentTime(): number {
  return new Date().getTime()
}

// 调度要达到的目的: 1. 分 loop 批量执行任务 2. 限制每个任务执行的时长，
//                防止某个任务长时间执行阻塞主线程 3. 按照任务优先级
//                优先执行优先级更高的其他任务 4. 根据之前暂停任务的
//                优先级，在适当的时机重新恢复该任务的执行，一旦再次执行
//                时间过长，重复步骤 2
// Job 特性: 延迟执行，过期时间，优先级，Job 一旦开始执行就必须执行完，
//          任务自身不能中断，除非通过传入的任务控制器由任务内部手动
//          进行暂停、恢复
//          任务并非注册之后就马上执行，而是需要等到 js 执行栈同步逻辑
//          全部执行完毕，再统一批量执行队列中存储的任务
// options: 任务执行期间是否支持动态插入新的任务？
//          任务是否支持自我控制？
//          任务的 hooks
//          
// 待定: 任务返回什么内容？任务传入控制器，支持任务内取消、恢复任务
// 调度系统的任务注册入口
// 通常一次非常庞大的 patch 操作会作为一个任务，但是这样会导致任务一旦执行
// 就无法停止，因此可以以 dom 节点为粒度将一个大任务拆分成一连串的单节点
// 渲染小任务，这样单个节点渲染任务执行时不会长时间执行，这样连续的渲染任务
// 可以在中间暂停执行，当需要恢复渲染时，再从之前断掉的节点继续执行后面的渲染任务
// dom 渲染任务是深度优先渲染，这样才能保证最早将一个 dom 节点完整的渲染出来
export function registerJob(
  job: Job,
  priority: number = JobPriorities.NORMAL,
  timeout?: number,
  delay: number = 0,
  options: JobOptions = EMPTY_OBJ,
  registerMode?: number
): Job {
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

  // 初始化任务注册模式
  registerMode = isNumber(registerMode) ? registerMode : RegisterModes.DEFAULT_ORDER

  // 优先以 job 本身携带的信息为准，因为 job 有可能重复注册
  job.id = `${SchedulerFlags.JOB_ID_BASE}${id++}`
  job.priority = job.priority || priority
  job.birth = genCurrentTime()
  job.timeout = job.timeout || timeout
  job.startTime = job.birth + job.delay
  job.delay = job.delay || delay
  job.options = job.options || options
  job.controller = createJobControllers(job, jobListRoot)
  job.hooks = options.hooks
  if (registerMode !== RegisterModes.AFTER_BLASTING_JOB) {
    job.expirationTime = job.startTime + job.timeout
  }

  // 为祖先任务创建子任务快照
  if (__DEV__ && options.openSnapshot) {
    createSnapshotForAncestor(job)
  }

  assignJob(job, registerMode)
  return job
}

// 为祖先任务创建快照容器
export function createSnapshotForAncestor(job: Job) {
  job.scopedSnapshot = createJobNode(null)
  // 创建快照双向循环链表，便于进行尾部节点的访问，省去遍历节点的开销
  job.scopedSnapshot.next = job.scopedSnapshot
  job.scopedSnapshot.previous = job.scopedSnapshot
}

// 调度系统的执行者
// 返回值表示执行队列当前 loop 是否全部执行完毕，全部执行完毕
// 返回 true，loop 中断则返回 false
// 每个 loop 跑完后都会去后补任务队列中获取高优任务，然后在
// 下个 loop 去执行。但是需要考虑一些延时较长的任务，在所有
// loop 全部跑完后依然没有时机去添加到执行队列中，那么这些任务
// 便没有了触发执行的时机
export function flushJobs(jobRoot: JobNode): boolean {
  isLoopPending = false
  isLoopRunning = true
  currentJobNode = head(jobRoot)
  deadline = genCurrentTime() + timeUnit
  while (currentJobNode !== null && isLoopValid) {
    if (shouldYield()) {
      // 当前 loop 执行中断结束，执行权让给高优先级的任务.
      // 将高优先级的任务添加到执行队列，然后在下一个 loop
      // 去恢复任务的批量执行
      fetchPriorJobs()
      requestRunLoop()
      isLoopRunning = false
      return false
    }

    currentJobNode = handleJob(currentJobNode, jobRoot)
  }

  // 当前 loop 结束
  isLoopRunning = false

  // 执行队列的任务全部执行完成，执行备选任务
  if (isListEmpty(jobRoot)) {
    requestRunBackup()
  }

  return true
}

// 当执行队列为空时，检测备选队列，并触发备选队列任务的执行，
// 并且不断重复该过程，直到两个队列中的任务全部被执行完毕
export function requestRunBackup(): void {
  const backupJobNode = head(backupListRoot)
  if (backupJobNode && backupJobNode.job) {
    // 有效任务节点
    const backupJob = backupJobNode.job
    const currentTime = genCurrentTime()
    if (backupJob.startTime <= currentTime) {
      popJob(backupListRoot)
      pushJob(backupJob, jobListRoot)
      requestRunLoop()
    } else {
      createMacrotask(
        flushBackup,
        [backupListRoot, jobListRoot],
        { delay: backupJob.startTime - currentTime }
      )
    }
  } else {
    // 无效任务节点
    popJob(backupListRoot)
  }
}

// 执行备选任务队列
export function flushBackup(backupRoot: JobNode, jobRoot: JobNode) {
  const { job: backupJob } = head(backupRoot)
  popJob(backupRoot)
  pushJob(backupJob, jobRoot)
  requestRunLoop()
}

// 获取备选任务队列中高优先级的任务，移动到执行队列中
// 如何处理已过期任务？
// 1. 过期任务根据任务的到期时间添加到执行队列，在下一个
//    loop 执行；
// 2. 过期任务在下一个 loop 开始前重新进行注册，作为全新的任务
//    在下一个 loop 时进入到执行队列中；
// 3. 过期任务不再进行后续处理，作为垃圾任务被丢弃掉
export function fetchPriorJobs(): void {
  let currentNode = head(backupListRoot)
  const currentTime = genCurrentTime()
  while (currentNode !== null) {
    const job = currentNode.job
    if (job.startTime <= currentTime) {
      if (job.isExpired) {
        // 过期任务处理
        const expireStrategy = job.options?.expireStrategy || ExpireStrategies.DEFAULT
        switch (expireStrategy) {
          case ExpireStrategies.REBIRTH:
            popJob(backupListRoot)
            rebirthJob(job)
            pushJob(job, jobListRoot)
            break
          case ExpireStrategies.IDLE:
            // 任务降级处理
            transformToIdle(job)
            popJob(backupListRoot)
            pushJob(job, jobListRoot)
            break
          case ExpireStrategies.REUSE:
            popJob(backupListRoot)
            pushJob(job, jobListRoot)
          default:
            // do nothing
        }
      } else {
        // 非过期任务处理
        popJob(backupListRoot)
        pushJob(job, jobListRoot)
      }
    } else {
      break
    }
    currentNode = head(backupListRoot)
  }
}

// 处理任务节点
export function handleJob(jobNode: JobNode, jobRoot: JobNode): JobNode {
  const job = jobNode.job
  const isExpired = job.expirationTime < genCurrentTime()
  if (!isExpired) {
    // 未过期任务处理
    // 任务如果返回子任务，说明该任务未执行完毕，后面还会
    // 继续执行，因此当前任务节点不出队，将子任务替换到当前
    // 任务节点上
    const childJob: Job = invokeJob(jobNode)
    if (childJob === null) {
      // 当前任务执行完毕，移出任务队列
      popJob(jobRoot)
      if (isFunction(jobNode.hooks?.onCompleted)) {
        // 当前任务节点全部处理完毕，执行对应的 hook
        jobNode.hooks?.onCompleted()
      }
    }
  } else {
    // 过期任务处理
    const expireStrategy: number = job.options?.expireStrategy || ExpireStrategies.DEFAULT
    switch (expireStrategy) {
      case ExpireStrategies.DEFAULT:
        const childJob: Job = invokeJob(jobNode, isExpired)
        if (childJob === null) {
          popJob(jobRoot)
          if (isFunction(jobNode.hooks?.onCompleted)) {
            // 当前任务节点全部处理完毕，执行对应的 hook
            jobNode.hooks?.onCompleted()
          }
        }
        break
      case ExpireStrategies.INVALID:
        // 过期任务被视为无效任务，直接从执行队列移除
        popJob(jobRoot)
        break
      default:
        // 过期任务首次被标记过期，会将其移动到备选任务队列，
        // 当该过期任务在后续的 loop 中被再次添加到执行队列
        // 中时，该任务将会优先执行，而不会被再次转移到备选任务队列
        if (isExpired && !job.isExpired) {
          popJob(jobListRoot)
          job.isExpired = true
          pushJob(job, backupListRoot)
        }
        break
    }
  }

  return head(jobRoot)
}

// 重生任务
export function rebirthJob(job: Job): void {
  job.birth = genCurrentTime()
  job.startTime = job.delay ? (job.birth + job.delay) : job.birth
  job.expirationTime = job.startTime + job.timeout
  const expireKey = 'isExpired'
  if (hasOwn(job, expireKey)) {
    deleteProperty(job, expireKey)
  }
}

// 将任务转换成 idle 等级任务，idle 等级任务永远不会过期，
// 将会在执行队列空闲时再执行
export function transformToIdle(job: Job): void {
  job.priority = JobPriorities.IDLE
  job.expirationTime = job.startTime + JobTimeouts.IDLE
}

export function head(JobRoot: JobNode): JobNode | null {
  return JobRoot.next || null
}

export function shouldYield() {
  const currentTime = genCurrentTime()
  return currentTime >= deadline
}

// 执行单个任务，返回有效子任务，说明当前任务未执行完，任务不出队；
// 否则表示该任务已执行完毕，需要做出队操作
export function invokeJob(jobNode: JobNode, ...jobArgs: any[]): Job | null {
  const job = jobNode.job
  if (isFunction(job)) {
    const childJob: Job | void = job(job.controller, ...jobArgs)

    // 将当前已执行完的子任务添加进快照
    if (__DEV__ && job.scopedSnapshot) {
      const currentNode = createJobNode(job)
      const lastNode = job.scopedSnapshot.previous
      lastNode.next = currentNode
      currentNode.previous = lastNode
      currentNode.next = job.scopedSnapshot
      job.scopedSnapshot.previous = currentNode
    }

    if (isFunction(childJob)) {
      const { isDeepFirst } = job.options
      // 根据任务是否深度优先执行分别进行处理
      if (isDeepFirst) {
        // 深度优先执行子任务
        jobNode.job = childJob

        // 将快照信息拷贝到子任务上，保证执行子任务时能访问到
        // 正确的快照链表信息
        if (__DEV__ && job.scopedSnapshot) {
          childJob.scopedSnapshot = job.scopedSnapshot
        }

        return childJob
      }
      // 子任务作为新任务重新注册入队
      registerJob(childJob)
      return null
    }
    
    // 无子任务
    return null
  }

  return null
}

// 任务执行暂停
export function pause(): void {
  isLoopValid = false
}

// 任务执行恢复
export function resume(): void {
  isLoopValid = true
}

// 取消任务
export function cancel(jobNode: JobNode): void {
  jobNode.job = null
}

// 创建任务控制器
export function createJobControllers(job: Job, jobRoot: JobNode): JobControllers {
  return {
    pause,
    resume,
    cancel(): void {
      return cancel(findJob(job, jobRoot))
    }
  }
}

// 任务编排与任务执行触发
export function assignJob(job: Job, registerMode: number) {
  if (!job.delay) {
    // 非延时任务
    pushJob(job, jobListRoot, registerMode)
    requestRunLoop()
  } else {
    // 延时任务 (备选任务的一种)
    pushJob(job, backupListRoot)
  }
}

// 请求开启一个任务执行 loop
export function requestRunLoop() {
  if (!isLoopPending) {
    createMacrotask(flushJobs, [jobListRoot])
    isLoopPending = true
  }
}

// 生成一个宏任务，不同环境生产出的宏任务有可能有差异性
// 为什么使用宏任务，原因是浏览器主线程每一个 event loop
// 是这样运行的:
// 运行 js 宏任务 -> 执行微任务 -> 布局计算 layout 及
// 渲染工作 -> 进入下一个 event loop，执行宏任务
// 宏任务是在渲染执行完之后才会执行，这样能够保证在下一轮
// 任务执行前，浏览器能够有时间去做渲染工作
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

// 创建任务节点
export function createJobNode(
  job: Job,
  type?: string | number,
  previous?: JobNode,
  next?: JobNode
): JobNode {
  const jobNode = createEmptyObject()
  jobNode.type = type
  jobNode.hooks = job.hooks
  return extend(
    jobNode,
    genBaseListNode(job, jobContentKey, previous, next)
  )
}

export function isRoot(jobNode: JobNode): boolean {
  return Boolean(jobNode.isRoot)
}

// 任务入队，构建最小堆任务队列
export function pushJob(job: Job, jobRoot: JobNode, registerMode?: number): boolean {
  if (!isFunction(job)) {
    return false
  }

  // 优先按照外部指定的注册模式进行任务编排
  if (registerMode === RegisterModes.AFTER_BLASTING_JOB) {
    const next = currentJobNode.next
    const jobNode = createJobNode(job, jobRoot.type)
    currentJobNode.next = jobNode
    next && (next.previous = jobNode)
    jobNode.previous = currentJobNode
    jobNode.next = next

    // 为保证注册任务的过期时间符合任务队列中的排序规则，因此将该任务
    // 的过期时间设置为与前一任务相同
    jobNode.job.expirationTime = currentJobNode?.job.expirationTime
    return true
  }

  // 按照 scheduler 默认编排策略进行任务编排
  // 从队列尾部向前遍历进行任务插入，因为相同优先级的任务一定是
  // 后注册的靠近队尾，尾部向前遍历在大部分 case 下都能用最少的遍历次数找到
  // 任务的目标插入位置
  const sortFlag =
    jobRoot.type === JobListTypes.JOB_LIST ?
      job.expirationTime:
      job.startTime
  let currentNode = jobRoot.previous
  while (currentNode !== null && !isRoot(currentNode)) {
    const currentJob = currentNode.job
    const currentSortFlag = 
      currentNode.type === JobListTypes.JOB_LIST ?
        currentJob.expirationTime :
        currentJob.startTime
    if (sortFlag >= currentSortFlag) {
      const nextChip = currentNode.next
      const node: JobNode = currentNode.next = nextChip.previous = createJobNode(job, jobRoot.type)
      node.previous = currentNode
      node.next = nextChip
      return true
    }
    currentNode = currentNode.previous
  }

  return true
}

// 任务出队
export function popJob(jobRoot: JobNode): boolean {
  const oldFirstNode = jobRoot.next
  if (oldFirstNode) {
    const firstNode = oldFirstNode.next
    jobRoot.next = firstNode
    firstNode.previous = jobRoot
    return true
  }

  return false
}

export function removeJob(job: Job, jobRoot: JobNode): boolean {
  let currentNode = jobRoot
  while (currentNode !== null) {
    if (currentNode.job === job) {
      // 匹配到目标任务，将该任务删除
      const preCHIP = currentNode.previous
      const nextNode = currentNode.next
      preCHIP.next = nextNode
      nextNode.previous = preCHIP
      return true
    }
    currentNode = currentNode.next
  }

  return false
}

export function findJob(job: Job, jobRoot: JobNode): JobNode | null {
  let currentNode = jobRoot
  while (currentNode !== null) {
    if (currentNode.job === job) {
      return currentNode
    }
    currentNode = currentNode.next
  }

  return null
}

export function hasJob(job: Job, jobRoot: JobNode): boolean | null {
  let currentNode = jobRoot
  while (currentNode !== null) {
    if (currentNode.job === job) {
      return true
    }
    currentNode = currentNode.next
  }

  return false
}

export function isListEmpty(listRoot: JobNode) {
  return !head(listRoot)
}
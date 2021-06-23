import { isNumber, MAX_INT, isFunction, EMPTY_OBJ } from "../../share/src"

export interface Job {
  (...args: any[]): Job | void
  id: number | string
  priority?: number
  birth?: number
  startTime?: number
  timeout?: number
  expirationTime?: number
  delay?: number
  options?: JobOptions
}

export interface JobNode {
  isRoot?: boolean
  type: number | string
  job: Job | null
  previous: JobNode | null
  next: JobNode | null
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

export const JobTimeouts = {
  INVALID: MAX_INT, // 无效优先级
  IMMEDIATE: -1, // 立即执行
  HIGH: 50, // 高优先级，如用户交互性事件
  NORMAL: 100, // 正常优先级，默认值
  LOW: 150, // 低优先级
  IDLE: MAX_INT // 闲置优先级，永远不会过期
}

export interface JobOptions {
  isDeepFirst?: boolean
}

// 每次开始新一轮的任务执行时都需要一个新的任务执行者，是每一轮任务执行的上下文
export interface JobController {
  pause?: unknown
  resume?: unknown
  cancel?: unknown
}

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
let timer: number | void
let currentJobNode: JobNode | void

// 任务队列使用链表的原因: 插入任务只需要查找和 1 次插入的开销，
// 如果使用数组这种连续存储结构，需要查找和移动元素的开销
// 执行队列
const jobListRoot: JobNode = {
  isRoot: true,
  type: JobListTypes.JOB_LIST,
  job: null,
  previous: null,
  next: null
}
// 备选任务执行队列
const backupListRoot: JobNode = {
  isRoot: true,
  type: JobListTypes.BACKUP_LIST,
  job: null,
  previous: null,
  next: null
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
  options: JobOptions = EMPTY_OBJ
): Job {
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

  // 优先以 job 本身携带的信息为准，因为 job 有可能重复注册
  job.id = `${SchedulerFlags.JOB_ID_BASE}${id++}`
  job.priority = job.priority || priority
  job.birth = genCurrentTime()
  job.timeout = job.timeout || timeout
  job.startTime = job.birth + job.delay
  job.expirationTime = job.startTime + job.timeout
  job.delay = job.delay || delay
  job.options = job.options || options

  assignJob(job)
  return job
}

// 调度系统的执行者
// 返回值表示执行队列当前 loop 是否全部执行完毕，全部执行完毕
// 返回 true，loop 中断则返回 false
// 每个 loop 跑完后都会去后补任务队列中获取高优任务，然后在
// 下个 loop 去执行。但是需要考虑一些延时较长的任务，在所有
// loop 全部跑完后依然没有时机去添加到执行队列中，那么这些任务
// 便没有了触发执行的时机
export function invokeJobs(jobRoot: JobNode): boolean {
  isLoopPending = false
  isLoopRunning = true
  let currentNode = head(jobRoot)
  deadline = genCurrentTime() + timeUnit
  while (currentNode !== null) {
    if (shouldYield()) {
      // 当前 loop 执行中断结束，执行权让给高优先级的任务.
      // 将高优先级的任务添加到执行队列，然后在下一个 loop
      // 去恢复任务的批量执行
      fetchPriorJobs()
      requestRunLoop()
      isLoopRunning = false
      return false
    }

    // 任务如果返回子任务，说明该任务未执行完毕，后面还会
    // 继续执行，因此当前任务节点不出队，将子任务替换到当前
    // 任务节点上
    const childJob = invokeJob(currentNode)
    if (childJob === null) {
      // 当前任务执行完毕，移出任务队列
      popJob(jobRoot)
    }
    currentNode = head(jobRoot)
  }

  isLoopRunning = false
  return true
}

// 获取备选任务队列中高优先级的任务，移动到执行队列中
export function fetchPriorJobs(): void {
  let currentNode = head(backupListRoot)
  const currentTime = genCurrentTime()
  while (currentNode !== null) {
    const job = currentNode.job
    if (job.startTime <= currentTime) {
      popJob(backupListRoot)
      pushJob(job, jobListRoot)
    } else {
      break
    }
    currentNode = head(backupListRoot)
  }
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
export function invokeJob(jobNode: JobNode): Job | null {
  const job = jobNode.job
  if (isFunction(job)) {
    const childJob: Job | void = job(genCurrentTime())
    if (isFunction(childJob)) {
      const { isDeepFirst } = job.options
      // 根据任务是否深度优先执行分别进行处理
      if (isDeepFirst) {
        // 深度优先执行子任务
        jobNode.job = childJob
        return childJob
      }
      // 子任务作为新任务重新注册入队
      return (registerJob(childJob), null)
    }
    
    // 无子任务
    return null
  }

  return null
}

// 任务编排与任务执行触发
export function assignJob(job: Job) {
  if (!job.delay) {
    // 非延时任务
    pushJob(job, jobListRoot)
    requestRunLoop()
  } else {
    // 延时任务 (备选任务)
    pushJob(job, backupListRoot)
    // 请求备选任务的调度执行
    requestInvokeBackupJob(job)
  }
}

// 请求开启一个任务执行 loop
export function requestRunLoop() {
  if (!isLoopPending) {
    createMacrotask(invokeJobs, 0, jobListRoot)
    isLoopPending = true
  }
}

export function requestInvokeBackupJob(jobNode: JobNode): void {
  const delay = jobNode.job.startTime - genCurrentTime()
  timer = createMacrotask(invokeBackupJob, delay, jobNode)
}

export function invokeBackupJob(jobNode: JobNode): void {
  const job = jobNode.job
  removeJob(job, backupListRoot)
  pushJob(job, jobListRoot)
  requestRunLoop()
}

export function createJobController(): JobController {
  return {
    pause() {

    },
    resume() {

    },
    cancel() {

    }
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
  cb: Function,
  delay: number = 0,
  ...cbArgs: any[]
): number | void {
  return timer = setTimeout(cb, delay, ...cbArgs)
}

export function createJobNode(job: Job, type: string | number): JobNode {
  return {
    type,
    job,
    previous: null,
    next: null
  }
}

// 任务入队
export function pushJob(job: Job, jobRoot: JobNode): boolean {
  if (!isFunction(job)) {
    return false
  }

  const sortFlag =
    jobRoot.type === JobListTypes.JOB_LIST ?
      job.expirationTime:
      job.startTime
  let currentNode = jobRoot
  while (currentNode !== null) {
    const currentJob = currentNode.job
    const currentSortFlag = 
      currentNode.type === JobListTypes.JOB_LIST ?
        currentJob.expirationTime :
        currentJob.startTime
    if (sortFlag <= currentSortFlag) {
      const prevNode = currentNode.previous
      const newNode = prevNode.next = createJobNode(job, jobRoot.type)
      newNode.previous = prevNode
      newNode.next = currentNode
      currentNode.previous = newNode
      return true
    }
    currentNode = currentNode.next
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
      const prevNode = currentNode.previous
      const nextNode = currentNode.next
      prevNode.next = nextNode
      nextNode.previous = prevNode
      return true
    }
    currentNode = currentNode.next
  }

  return false
}

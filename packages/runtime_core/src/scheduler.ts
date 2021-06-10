import { isNumber, MAX_INT, isFunction } from "../../share/src"

export interface Job {
  (): Job | void
  id: number | string
  priority?: number
  birth?: number
  startTime?: number
  timeout?: number
  expirationTime?: number
  delay?: number
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

}

// 每次开始新一轮的任务执行时都需要一个新的任务执行者，是每一轮任务执行的上下文
export interface JobInvoker {
  pauser: unknown
  resumer: unknown
  canceler: unknown
}

let id = 0
// 每帧的时间片单元，是每帧时间内用来执行 js 逻辑的最长时长，任务
// 连续执行超过时间片单元，就需要中断执行把主线程让给优先级更高的任务
const timeUnit = 8
// 任务 loop 处于 pending 阶段，积累执行队列中的任务
let isLoopPending = false
// 任务 loop 是否处于 running 阶段，批量执行执行队列中的任务
let isLoopRunning = false
let timer: number
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
  timeout: number,
  delay: number = 0,
  options: JobOptions
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

  job.id = `${SchedulerFlags.JOB_ID_BASE}${id++}`
  job.priority = priority
  job.birth = genCurrentTime()
  job.startTime = genCurrentTime()
  job.timeout = timeout
  job.expirationTime = job.startTime + timeout
  job.delay = delay

  assignJob(job)
  return job
}

// 调度系统的执行者
// 返回值表示执行队列当前 loop 是否全部执行完毕，全部执行完毕
// 返回 true，loop 中断则返回 false
export function invokeJobs(jobRoot: JobNode): boolean {
  let currentNode = jobRoot
  while (currentNode !== null) {
    // TODO 执行执行队列中的任务，当任务执行完毕时任务出队
    currentNode = currentNode.next
  }

  return true
}

// 任务编排与任务执行触发
export function assignJob(job: Job) {
  if (!job.delay) {
    // 非延时任务
    pushJob(job, jobListRoot)
    if (!isLoopPending) {
      createMacrotask(invokeJobs, 0, jobListRoot)
    }
  } else {
    // 延时任务

  }
}

export function createJobInvoker(): JobInvoker {

}

// 生成一个宏任务，不同环境生产出的宏任务有可能有差异性
export function createMacrotask(
  cb: Function,
  delay: number = 0,
  ...cbArgs: any[]
) {
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

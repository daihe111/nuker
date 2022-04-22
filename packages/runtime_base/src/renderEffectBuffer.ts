/**
 * 渲染任务缓冲区，通过微任务 (microtask) 收集当前 event loop 中产生
 * 的渲染更新任务，之所以将一个 event loop 中的渲染副作用收集并批量
 * 同步执行，是因为我们不希望同一 event loop 中的渲染任务之间插入其他
 * 执行逻辑，渲染任务之间插入其他执行逻辑会导致视图断断续续的刷新
 * e.g. patch task1(1s) -> other task(3s) -> patch task2(1s)
 * task1 对应视图刷新后需要等待 3s 才会刷新 task2 对应的视图，这样
 * 视觉上的体验会很差
 */

import { Effect } from "../../reactivity/src/effect";
import { isFunction } from "../../share/src";

export interface BufferNode {
  effect: Effect
  next: BufferNode
}

export interface Buffers {
  syncBuffer: BufferNode
  concurrentBuffer: BufferNode
}

export interface RenderEffectBufferOptions {
  onFlushed?: () => void
}

// 渲染 effect 类型
export const enum RenderEffectTypes {
  SYNC = 0, // 可立即渲染到实际的 dom 视图上
  CONCURRENT = 1 // 渲染任务需要进行 reconcile
}

export const enum BufferStatuses {
  HIBERNATING = 0, // 缓冲区休眠中 (默认态)
  PENDING = 1, // 缓冲区队列准备中
  RUNNING = 2 // 缓冲区任务执行中
}

export const enum RenderEffectFlags {
  RENDER_MODE = '__n_renderMode'
}

export const enum BufferTypes {
  SYNC = 'syncBuffer',
  CONCURRENT = 'concurrentBuffer'
}

export const RenderEffectBufferMap = {
  [RenderEffectTypes.SYNC]: BufferTypes.SYNC,
  [RenderEffectTypes.CONCURRENT]: BufferTypes.CONCURRENT
}

const buffers: Buffers = {
  syncBuffer: null, // 同步任务缓冲区
  concurrentBuffer: null // concurrent 任务缓冲区
} // 任务缓冲队列集
let status: number = BufferStatuses.HIBERNATING // 缓冲区状态
let onFlushed: (...args: unknown[]) => void // 缓冲区任务全部执行完毕后触发执行的 hook
const effectCache: WeakMap<Effect, true> = new WeakMap() // 缓冲区当前已存在 effect 缓存记录

/**
 * 对外暴露 API
 * 初始化缓冲区配置
 * @param param
 */
export function initRenderEffectBuffer({ onFlushed: fl }: RenderEffectBufferOptions): void {
  onFlushed = fl
}

/**
 * 对外部暴露的 API
 * 将 renderEffect 注册进入缓冲区
 * @param effect 
 */
export function pushRenderEffectToBuffer(effect: Effect): void {
  pushBuffer(effect)

  if (status === BufferStatuses.HIBERNATING) {
    status = BufferStatuses.PENDING
    createMicrotask(flushBuffers)
  }
}

/**
 * effect 推入缓冲区
 * @param effect 
 */
function pushBuffer(effect: Effect): BufferNode {
  if (hasCache(effect)) {
    return null
  }

  const bufferNode: BufferNode = createBufferNode(effect)
  const bufferType: string = RenderEffectBufferMap[effect.effectType]
  const buffer: BufferNode = buffers[bufferType]
  if (buffer) {
    buffer.next = bufferNode
  } else {
    buffers[bufferType] = bufferNode
  }
  cache(effect)
  return buffer
}

/**
 * 缓冲区队头节点出队
 */
function popBuffer(bufferType: string): BufferNode {
  const oldBuffer: BufferNode = buffers[bufferType].next
  buffers[bufferType] = oldBuffer
  
  removeCache(oldBuffer.effect)
  return buffers[bufferType]
}

function cache(effect: Effect): void {
  effectCache.set(effect, true)
}

function removeCache(effect: Effect): void {
  effectCache.delete(effect)
}

function hasCache(effect: Effect): boolean {
  return effectCache.has(effect)
}

/**
 * 返回队头节点
 * @param root 
 */
function head(root: BufferNode): BufferNode {
  return root || null
}

/**
 * 批量执行缓冲区 renderEffect
 */
function flushBuffers(): void {
  status = BufferStatuses.RUNNING
  for (const bufferType in buffers) {
    flushBuffer(bufferType)
  }

  if (isFunction(onFlushed)) {
    onFlushed()
  }
  // 所有缓冲区队列均已执行并清空
  status = BufferStatuses.HIBERNATING
}

/**
 * 批量执行指定缓冲区积累的 renderEffect
 * @param buffer 
 */
function flushBuffer(bufferType: string): boolean {
  const buffer: BufferNode = buffers[bufferType]
  let currentNode: BufferNode = buffer
  while (currentNode !== null) {
    currentNode.effect()
    currentNode = head(popBuffer(bufferType))
  }

  return true
}

export function createBufferNode(effect: Effect): BufferNode {
  return { effect, next: null }
}

/**
 * 创建微任务
 * @param callback 
 * @param cbArgs 
 */
export function createMicrotask(callback: Function, ...cbArgs: any[]): Promise<any> {
  return Promise.resolve()
    .then(() => {
      callback(...cbArgs)
    })
}
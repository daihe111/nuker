/**
 * 渲染任务缓冲区，通过微任务 (microtask) 收集当前 event loop 中产生
 * 的渲染更新任务，之所以将一个 event loop 中的渲染副作用收集并批量
 * 同步执行，是因为我们不希望同一 event loop 中的渲染任务之间插入其他
 * 执行逻辑，渲染任务之间插入其他执行逻辑会导致视图断断续续的刷新
 * e.g. patch task1(1s) -> other task(3s) -> patch task2(1s)
 * task1 对应视图刷新后需要等待 3s 才会刷新 task2 对应的视图，这样
 * 视觉上的体验会很差
 */

import { Effect, injectIntoEffect } from "../../reactivity/src/effect";
import { RenderModes, renderMode, NukerRenderModes } from "./workRender";

export interface BufferNode {
  effect: Effect
  next: BufferNode
}

// 渲染 effect 类型
export const enum RenderEffectTypes {
  SYNC = 0, // 可立即渲染到实际的 dom 视图上
  CONCURRENT = 1 // 渲染任务需要进行 reconcile 并接入调度系统
}

export const enum RenderEffectFlags {
  RENDER_MODE = '__n_renderMode',
  END_IN_LOOP = '__n_endInLoop'
}

// 任务缓冲区
let buffer: BufferNode = null
let isPending: boolean = false // buffer 是否处于准备态
let isRunning: boolean = false // buffer 是否处于执行态
// 缓冲区当前已存在 effect 缓存记录
const effectCache: WeakMap<Effect, true> = new WeakMap()

export function pushRenderEffectToBuffer(effect: Effect): void {
  pushBuffer(effect)

  if (!isPending) {
    isPending = true
    createMicrotask(flushBuffer, buffer)
  }
}

// effect 推入缓冲区
function pushBuffer(effect: Effect): BufferNode {
  if (hasCache(effect)) {
    return null
  }

  const bufferNode: BufferNode = createBufferNode(effect)
  if (buffer) {
    buffer.next = bufferNode
  } else {
    buffer = bufferNode
  }
  cache(effect)
  return buffer
}

// 缓冲区队头节点出队
function popBuffer(): BufferNode {
  const oldBuffer: BufferNode = buffer
  buffer = buffer?.next || null
  removeCache(oldBuffer.effect)
  return buffer
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

// 返回队头节点
function head(root: BufferNode): BufferNode {
  return root || null
}

// 对缓冲区的 render effect 进行分析，分析出本次 event loop 的渲染
// 模式，并根据渲染模式进行 render effect 的派发
export function flushBuffer(buffer: BufferNode): void {
  isPending = false
  isRunning = true

  switch (renderMode) {
    case NukerRenderModes.BATCH_SYNC_PREFERENTIALLY:
      flushBufferSyncPreferentially(buffer)
      break
    default:
      flushBufferSyncPreferentially(buffer)
      break
  }
  // TODO 考虑下是否等当前 buffer 全部执行完毕后一次性清空 buffer

  if (buffer === null) {
    isRunning = false
  }
}

/**
 * BATCH_SYNC_PREFERENTIALLY 渲染模式下批量执行 render effect 的逻辑
 * @param buffer 
 */
function flushBufferSyncPreferentially(buffer: BufferNode): void {
  let currentNode: BufferNode = buffer
  while (currentNode !== null) {
    currentNode.effect()
    currentNode = head(popBuffer())
  }
}

/**
 * BATCH_BY_EVENT_LOOP 渲染模式下批量执行 render effect 的逻辑
 * TODO 待废弃
 * @param buffer 
 */
function flushBufferConsistentlyInEventLoop(buffer: BufferNode): void {
  // 1. 遍历 buffer 中所有 effect，根据所有 effect 的类型
  // 分析出本轮 event loop 采用哪种模式进行渲染更新
  let currentNode: BufferNode = buffer
  let renderMode: number = RenderModes.SYNCHRONOUS
  while (currentNode !== null) {
    if (currentNode.effect?.effectType === RenderEffectTypes.CONCURRENT) {
      renderMode = RenderModes.CONCURRENT
      break
    }
    currentNode = currentNode.next
  }

  // 更新渲染模式标记
  // pushRenderMode(renderMode)

  // 2. buffer 中的 effect 派发，处理完成的 effect 将移出缓冲区
  currentNode = buffer
  while (currentNode !== null) {
    const effect: Effect = currentNode.effect
    // 为 effect 注入渲染模式信息
    injectIntoEffect(
      effect,
      RenderEffectFlags.RENDER_MODE,
      renderMode
    )
    // 如果是 buffer 中最后一个 effect 节点且为 concurrent 渲染模式，
    // 将其标记为当前 event loop 最后一个任务
    if (currentNode.next === null) {
      injectIntoEffect(
        currentNode.effect,
        RenderEffectFlags.END_IN_LOOP,
        true
      )
    }
    // 执行渲染副作用
    effect()
    currentNode = head(popBuffer())
  }
}

export function createBufferNode(effect: Effect): BufferNode {
  return { effect, next: null }
}

// 创建微任务
export function createMicrotask(callback: Function, ...cbArgs: any[]): Promise<any> {
  return Promise.resolve()
    .then(() => {
      callback(...cbArgs)
    })
}
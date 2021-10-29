/**
 * 任务缓冲区，通过微任务 (microtask) 统计当前 event loop 中产生
 * 的渲染更新任务，标记出当前 event loop 需要采用哪一类更新，是同步
 * 更新模式还是 concurrent 模式，这将直接决定本次 event loop 中
 * 渲染更新的执行效率
 */

import { Effect } from "../../reactivity/src/effect";
import { RenderModes, refreshRenderMode } from "./workRender";

export interface BufferNode {
  effect: Effect
  next: BufferNode
}

// 渲染 effect 类型
export const enum RenderEffectTypes {
  PATCH_IMMEDIATELY = 0,
  NEED_RECONCILE = 1
}

// 任务缓冲区
let buffer: BufferNode = null
let isPending: boolean = false
let isRunning: boolean = false

export function pushRenderEffectToBuffer(effect: Effect): void {
  const bufferNode: BufferNode = createBufferNode(effect)
  if (buffer) {
    buffer.next = bufferNode
  } else {
    buffer = bufferNode
  }

  if (!isPending) {
    isPending = true
    createMicrotask(flushBuffer, buffer)
  }
}

export function flushBuffer(buffer: BufferNode): void {
  // 1. 遍历 buffer 中所有 effect，根据所有 effect 的类型
  // 分析出本轮 event loop 采用哪种模式进行渲染更新
  let currentNode: BufferNode = buffer
  let renderMode: number = RenderModes.SYNCHRONOUS
  while (currentNode !== null) {
    if (currentNode.effect?.effectType === RenderEffectTypes.NEED_RECONCILE) {
      renderMode = RenderModes.CONCURRENT
      break
    }
    currentNode = currentNode.next
  }

  // 更新渲染模式标记
  refreshRenderMode(renderMode)

  // 2. buffer 中的 effect 派发或作为任务注册进 scheduler
  // 以接受调度，处理完成的 effect 将移出缓冲区
  
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
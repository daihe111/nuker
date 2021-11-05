/**
 * 任务缓冲区，通过微任务 (microtask) 统计当前 event loop 中产生
 * 的渲染更新任务，标记出当前 event loop 需要采用哪一类更新，是同步
 * 更新模式还是 concurrent 模式，这将直接决定本次 event loop 中
 * 渲染更新的执行效率
 */

import { Effect, injectIntoEffect } from "../../reactivity/src/effect";
import { RenderModes, pushRenderMode } from "./workRender";
import { registerJob, JobPriorities } from "./scheduler";
import { performCommitWork } from "./commit";

export interface BufferNode {
  effect: Effect
  next: BufferNode
}

// 渲染 effect 类型
export const enum RenderEffectTypes {
  CAN_DISPATCH_IMMEDIATELY = 0, // 可立即渲染到实际的 dom 视图上
  NEED_SCHEDULE = 1 // 渲染任务需要进行 reconcile 并接入调度系统
}

// 任务缓冲区
let buffer: BufferNode = null
let isPending: boolean = false // buffer 是否处于准备态
let isRunning: boolean = false // buffer 是否处于执行态

export function pushRenderEffectToBuffer(effect: Effect): void {
  pushBuffer(effect)

  if (!isPending) {
    isPending = true
    createMicrotask(flushBuffer, buffer)
  }
}

// effect 推入缓冲区
function pushBuffer(effect: Effect): BufferNode {
  const bufferNode: BufferNode = createBufferNode(effect)
  if (buffer) {
    buffer.next = bufferNode
  } else {
    buffer = bufferNode
  }
  return buffer
}

// 缓冲区队头节点出队
function popBuffer(): BufferNode {
  const oldRoot: BufferNode = buffer
  buffer = buffer?.next || null
  oldRoot.effect = oldRoot.next = null
  return buffer
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

  // 1. 遍历 buffer 中所有 effect，根据所有 effect 的类型
  // 分析出本轮 event loop 采用哪种模式进行渲染更新
  let currentNode: BufferNode = buffer
  let renderMode: number = RenderModes.SYNCHRONOUS
  while (currentNode !== null) {
    if (currentNode.effect?.effectType === RenderEffectTypes.NEED_SCHEDULE) {
      renderMode = RenderModes.CONCURRENT
      break
    }
    currentNode = currentNode.next
  }

  // 更新渲染模式标记
  // pushRenderMode(renderMode)

  // 2. buffer 中的 effect 派发或作为任务注册进 scheduler
  // 以接受调度，处理完成的 effect 将移出缓冲区
  const propKeys: string[] = ['renderMode', 'endInLoop']
  currentNode = buffer
  while (currentNode !== null) {
    // 为 effect 注入渲染模式信息
    injectIntoEffect(currentNode.effect, propKeys[0], renderMode)
    if (currentNode.next === null) {
      // 如果是 buffer 中最后一个 effect 节点，将其标记为当前 event loop
      // 最后一个任务
      injectIntoEffect(currentNode.effect, propKeys[1], true)
    }
    currentNode = head(popBuffer())
  }
  // TODO 考虑下是否等当前 buffer 全部执行完毕后一次性清空 buffer

  if (buffer === null) {
    isRunning = false
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
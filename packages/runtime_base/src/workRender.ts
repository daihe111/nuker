import { Chip, ChipRoot, ChipUnit, ChipPhases } from "./chip";
import { genBaseListNode, isArray, isNumber, isString, isObject } from "../../share/src";
import { VNode, VNodeChildren, UnitTypes, VNodeFlags, getFirstVNodeChild } from "./vnode";
import { registerJob } from "./scheduler";
import { ComponentInstance, Component, createComponentInstance, reuseComponentInstance } from "./component";
import { domOptions } from "./domOptions";

export const enum RenderModes {
  SYNCHRONOUS = 0,
  CONCURRENT = 1
}

const dynamicChipKey = Symbol()
// 包含动态内容的 chip 链表
const dynamicChipList = genBaseListNode(null, dynamicChipKey)
// 正在进行中的 chip 节点
let ongoingChip: ChipUnit = null
// 当前正在执行渲染工作的组件 instance
let currentRenderingInstance: ComponentInstance = null

// update types: 
// unstable dom (if-structure, for-structure)
// stable dom props
// stable children (text node)

// source change -> trigger effect -> gen update payload
// -> update payload: { type: 'updateProps', elm, content: { prop1, prop2 }, next: null }
// the update payload struct a update list
// update types: updateProps, remove, append, replace, move

// tasks: reconcile, user event (CPU-scheduled)
// update payload: run sync

// 单个任务要做的工作：
// 首次渲染：每个节点生成对应的 update payload，依赖收集
// 更新：包含 update payload 生成逻辑的 effect，该 effect
// 作为当前正在处理的任务节点

// 首次渲染：有向图 chip 节点遍历，产生的任务：渲染准备、update payload
// 更新：渲染信息更新 (instance, data source...)、update payload (保证由子到父倒序执行，离屏渲染)

// 同步执行任务循环
export function workLoopSync(chipRoot: ChipRoot, chip: Chip) {
  ongoingChip = chip
  while (ongoingChip !== null) {
    ongoingChip = performChipWork(chipRoot, ongoingChip)
  }
}

// 以异步可调度的方式执行任务循环
export function workLoopConcurrent(chipRoot: ChipRoot, chip: Chip) {
  registerOngoingChipWork(chipRoot, chip)
}

export function registerOngoingChipWork(chipRoot: ChipRoot, chip: Chip) {
  ongoingChip = chip
  registerJob(() => {
    // get next chip to working
    const next = performChipWork(chipRoot, chip)
    registerOngoingChipWork(chipRoot, next)
  })
}

// chip unit work 执行
export function performChipWork(chipRoot: ChipRoot, chip: Chip): Chip {
  if (chip === null) {
    return null
  }

  if (chip.phase === ChipPhases.PENDING) {
    // 首次遍历处理当前 chip 节点
    initRenderWorkForChip(chip)
    chip.phase = ChipPhases.INITIALIZE

    let firstChild = chip.firstChild
    if (!firstChild) {
      const firstVNodeChild = getFirstVNodeChild(chip.children)
      chip.firstChild = firstChild = createChipFromVNode(firstVNodeChild)
      if (firstChild) {
        firstChild.parent = chip
        chip.currentChildIndex = 0
        return firstChild
      } else {
        return completeChip(chipRoot, chip)
      }
    }
  } else if (chip.phase === ChipPhases.INITIALIZE) {
    // 该节点在 dive | swim 阶段已经遍历过，此时为祖先节点回溯阶段
    genMutableEffects(chipRoot, chip)
  }
}

// 首次挂载遍历处理 chip tree
export function workChipsByFirstMount(chipRoot: ChipRoot) {
  ongoingChip = chipRoot
  
}

// 非首次挂载遍历处理 chip tree
export function workChipsByUpdate(chipRoot: ChipRoot) {

}

// 需进行 dive-swim-bubble 后序遍历模型，保证 effect 的先子后父进行挂载
// 便于 commit 阶段实用内存进行离屏渲染
export function traverseChipTree(parent: Chip, children?: VNodeChildren): void {
  
}

// 为当前 chip 执行可供渲染用的相关准备工作
export function initRenderWorkForChip(chip: Chip) {
  switch (chip.unitType) {
    case UnitTypes.CUSTOM_COMPONENT:
      initRenderWorkForComponent(chip)
      break
    case UnitTypes.NATIVE_DOM:
      initRenderWorkForElement(chip)
      break
  }
}

// chip 是 leaf node，完成对该节点的所有处理工作，并标记为 complete
// 返回下一个要处理的 chip 节点
export function completeChip(chipRoot: ChipRoot, chip: Chip): Chip {
  chip.phase = ChipPhases.COMPLETE
  genMutableEffects(chipRoot, chip)
  let sibling = chip.nextSibling
  if (sibling === null) {
    // finish dive and start swim to handle sibling node
    const parent = chip.parent
    const nextVNodeChild: VNode = parent.children[parent.currentChildIndex + 1]
    if (nextVNodeChild[VNodeFlags.IS_VNODE]) {
      // 当前 chip 有有效的兄弟节点
      sibling = chip.nextSibling = createChipFromVNode(nextVNodeChild)
      sibling.prevSibling = chip
      sibling.parent = parent
      parent.currentChildIndex++
      return sibling
    } else {
      // 无有效兄弟节点，且当前 chip 已处理完毕，开始进入 bubble 阶段，
      // 回溯父节点
      return parent
    }
  } else {
    return (sibling as Chip)
  }
}

// 依赖收集，生成触发 dom 实际变化的副作用:
// 1. 首次渲染: 不会生成渲染描述，而是直接通过 chip 中的信息
//    进行 dom 的实际渲染
// 2. 更新阶段: 会先生成节点对应的更新渲染描述 payload，因为
//    非首次渲染时 reconcile 任务不再是优先级最高的任务，因为
//    有可能会有优先级更高的任务插入 (如 user event)，因此
//    更新阶段的纯 js 任务需要接入调度系统，然后所有的 dom 操作
//    在 commit 阶段进行批量同步执行
export function genMutableEffects(chipRoot: ChipRoot, chip: Chip, mode: number) {
  switch (mode) {
    case RenderModes.SYNCHRONOUS:
      mountChip(chipRoot, chip)
      break
    case RenderModes.CONCURRENT:

      break
    default:
      // an nuker bug maybe has occurred
      break
  }
}

export function createChipFromVNode(vnode: VNode): Chip | null {
  return
}

// 初始化 component 类型节点的渲染工作
export function initRenderWorkForComponent(chip: Chip): void {
  const instance = chip.instance
  if (instance === null) {
    // first mount 创建组件类型 chip 对应的 instance
    currentRenderingInstance = chip.instance = createComponentInstance((chip.tag as Component), chip)
    // mount component
    mountComponent()
  } else {
    // 复用已经存在的 instance
    chip.instance = reuseComponentInstance(instance, chip)
  }
}

// 初始化 element 类型节点的渲染工作
export function initRenderWorkForElement(chip: Chip) {
  const { tag, isSVG, is, props } = chip
  chip.elm = domOptions.createElement(tag, isSVG, is, props)
}

export function completeRenderWorkForElement(chip: Chip) {
  const parentElm = chip.parent.elm
  if (parentElm) {
    parentElm.appendChild(chip.elm)
  }
}

// 将 chip 挂载到 dom 视图上 (仅进行内存级别的 dom 操作)
export function mountChip(chipRoot: ChipRoot, chip: Chip): void {
  switch (chip.unitType) {
    case UnitTypes.NATIVE_DOM:
      mountElement(chipRoot, chip)
      break
    case UnitTypes.CUSTOM_COMPONENT:
      mountComponent(chipRoot, chip)
      break
    case UnitTypes.CONDITION:
      mountCondition(chipRoot, chip)
      break
    case UnitTypes.FRAGMENT:
      mountFragment(chipRoot, chip)
      break
    default:
      // nuker doesn't have this node type, a bug maybe occurred
      break
  }
}

export function mountElement(chipRoot: ChipRoot, chip: Chip): object {
  
}
import {
  Chip,
  ChipRoot,
  ChipUnit,
  ChipPhases,
  ChipChildren,
  ChipTypes,
  ChipFlags,
  getFirstChipChild,
  ChipPropNode,
  isSameChip,
  ChipTypeNames,
  cloneChip,
  createChip
} from "./chip";
import { genBaseListNode, isArray, isNumber, isString, isObject, isFunction, createEmptyObject } from "../../share/src";
import { registerJob, Job } from "./scheduler";
import { ComponentInstance, Component, createComponentInstance, reuseComponentInstance } from "./component";
import { domOptions } from "./domOptions";
import { effect, disableCollecting, enableCollecting } from "../../reactivity/src/effect";
import { commitRenderPayloads } from "./commit";
import { createVirtualChipInstance, VirtualInstance } from "./virtualChip";

export interface ReconcileChipPair {
  oldChip: Chip | null
  newChip: Chip | null
}

export interface ChildrenRenderer {
  source: any
  render: (source: any) => ChipChildren
}

export interface DynamicRenderData {
  props?: Record<string | number | symbol, any>
  children?: ChipChildren
}

export const enum RenderFlags {
  IS_RENDER_PAYLOAD = '__n_isRenderPayload'
}

export interface RenderPayloadNode {
  // flags
  [RenderFlags.IS_RENDER_PAYLOAD]: true

  // data
  type: number
  container?: Element
  parentContainer?: Element
  anchorContainer?: Element | null
  tag?: string
  props: Record<string | number | symbol, any>
  context: Chip

  // pointers
  next: RenderPayloadNode | null
}

export const enum RenderModes {
  SYNCHRONOUS = 0,
  CONCURRENT = 1
}

export const enum RenderUpdateTypes {
  PATCH_PROP = 1,
  PATCH_CHILDREN = 1 << 1,
  MOUNT = 1 << 2,
  UNMOUNT = 1 << 3,
  REPLACE = 1 << 4,
  MOVE = 1 << 5,
  INVALID = -1
}

// fragment 节点对应的子节点属性
const fragmentChildrenPropKey = Symbol()
const dynamicChipKey = Symbol()
// 包含动态内容的 chip 链表
const dynamicChipList = genBaseListNode(null, dynamicChipKey)
// 正在进行中的 chip 节点
let ongoingChip: ChipUnit = null
// 当前正在执行渲染工作的组件 instance
let currentRenderingInstance: ComponentInstance = null
// 当前正在生成的 RenderPayloadNode
let currentRenderPayload: RenderPayloadNode

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
    ongoingChip = performChipWork(chipRoot, ongoingChip, RenderModes.SYNCHRONOUS)
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
    const next = performChipWork(chipRoot, chip, RenderModes.CONCURRENT)
    registerOngoingChipWork(chipRoot, next)
  })
}

// chip unit work 执行
export function performChipWork(chipRoot: ChipRoot, chip: Chip, mode: number): Chip {
  if (chip === null) {
    return null
  }

  if (chip.phase === ChipPhases.PENDING) {
    // 首次遍历处理当前 chip 节点
    initRenderWorkForChip(chip)
    chip.phase = ChipPhases.INITIALIZE

    // 对于包含动态子节点执行器 render 的 chip，如虚拟容器类型、
    // 组件类型的 chip 节点，init 阶段已经建立了父子关系，因此
    // firstChild 已经有有效 chip 节点
    let firstChild = chip.firstChild
    if (!firstChild) {
      const firstChipChild = getFirstChipChild(chip.children)
      chip.firstChild = firstChild = firstChipChild
      let next: Chip
      if (firstChild) {
        firstChild.parent = chip
        chip.currentChildIndex = 0
        next = firstChild
      } else {
        next = completeChip(chipRoot, chip, mode)
      }

      return next
    } else {
      return firstChild
    }
  } else if (chip.phase === ChipPhases.INITIALIZE) {
    // 该节点在 dive | swim 阶段已经遍历过，此时为祖先节点回溯阶段
    return completeChip(chipRoot, chip, mode)
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
export function traverseChipTree(parent: Chip, children?: ChipChildren): void {
  
}

// 为当前 chip 执行可供渲染用的相关准备工作
export function initRenderWorkForChip(chip: Chip) {
  switch (chip.chipType) {
    case ChipTypes.CUSTOM_COMPONENT:
      initRenderWorkForComponent(chip)
      break
    case ChipTypes.RESERVED_COMPONENT:
      initRenderWorkForReservedComponent(chip)
      break
    case ChipTypes.NATIVE_DOM:
      initRenderWorkForElement(chip)
      break
    case ChipTypes.CONDITION:
    case ChipTypes.FRAGMENT:
      initRenderWorkForVirtualChip(chip)
      break
  }
}

// chip 是 leaf node，完成对该节点的所有处理工作，并标记为 complete
// 返回下一个要处理的 chip 节点
export function completeChip(chipRoot: ChipRoot, chip: Chip, mode: number): Chip {
  chip.phase = ChipPhases.COMPLETE
  genMutableEffects(chipRoot, chip, mode)

  // 计算下一个要处理的节点
  let sibling = chip.nextSibling
  if (sibling === null) {
    // finish dive and start swim to handle sibling node
    const parent = chip.parent
    const nextChipChild: Chip = parent.children[parent.currentChildIndex + 1]
    if (nextChipChild[ChipFlags.IS_CHIP]) {
      // 当前 chip 有有效的兄弟节点
      sibling = chip.nextSibling = nextChipChild
      sibling.prevSibling = chip
      sibling.parent = parent
      parent.currentChildIndex++
      return sibling
    } else {
      // 无有效兄弟节点，且当前 chip 已处理完毕，开始进入 bubble 阶段，
      // 回溯祖先节点
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
      completeRenderWorkForChipSync(chipRoot, chip)
      break
    case RenderModes.CONCURRENT:
      completeRenderWorkForChipConcurrent(chipRoot, chip)
      break
    default:
      // an nuker bug maybe has occurred
      break
  }
}

// 初始化 component 类型节点的渲染工作
export function initRenderWorkForComponent(chip: Chip): void {
  const { source, render } = (chip.instance as ComponentInstance) = createComponentInstance((chip.tag as Component), chip)
  // 此处仅通过 render 渲染器获取组件节点的子节点，不做响应式系统的依赖收集
  disableCollecting()
  chip.children = render(source)
  // 恢复响应式系统的依赖收集
  enableCollecting()
}

// 初始化 nuker 内置 component 类型节点的渲染工作
export function initRenderWorkForReservedComponent(chip: Chip): void {

}

// 初始化 element 类型节点的渲染工作: dom 容器创建
export function initRenderWorkForElement(chip: Chip) {
  const { tag, isSVG, is } = chip
  chip.elm = domOptions.createElement(tag, isSVG, is)
}

// 初始化虚拟容器类型节点的渲染工作
export function initRenderWorkForVirtualChip(chip: Chip): void {
  const { source, render } = (chip.instance as VirtualInstance) = createVirtualChipInstance(chip)
  // 建立响应式系统与渲染 effect 之间的关系
  effect<DynamicRenderData>(() => {
    // collector: 触发当前注册 effect 的收集行为
    const children: ChipChildren = render(source)
    // TODO 需要确认是否每次触发更新都更新 chip.children
    chip.children = children
    return { children }
  }, (newData: DynamicRenderData) => {
    // dispatcher: 响应式数据更新后触发
    return genRenderPayloads(chip, newData)
  }, {
    collectOnly: true, // 首次仅做依赖收集但不执行派发逻辑
    scheduler: (job: Job) => {
      // 将渲染更新任务注册到调度系统中
      registerJob(job)
    }
  })

  // TODO 虚拟容器节点 props 也需要建立响应式关系
}


/**
 * 获取传入 chip 节点对应的可插入祖先 dom 容器
 * @param chip 
 */
export function getAncestorContainer(chip: Chip): Element {
  let current: Chip = chip.parent
  while (current.elm === null)
    current = current.parent
  return current.elm
}

// 完成 element 类型节点的渲染工作: 当前节点插入父 dom 容器
export function completeRenderWorkForElement(chip: Chip) {
  // 将当前 chip 对应的实体 dom 元素插入父 dom 容器
  const parentElm: Element = getAncestorContainer(chip)
  const elm = chip.elm
  if (parentElm && elm) {
    domOptions.appendChild(elm, parentElm)
  }

  // 检索当前 element 节点的属性，区分动态属性和静态属性
  const props = chip.props
  for (const propName in props) {
    // 收集动态属性，动态属性的 value 是 wrapper 化的，避免
    // 访问属性 value 时是立即执行的
    const { isDynamic, value } = (props[propName] as ChipPropNode)
    if (isDynamic) {
      // 针对当前 chip 节点的动态属性创建对应的渲染 effect
      effect<DynamicRenderData>(() => {
        // collector: 触发当前注册 effect 的收集行为
        return { props: { [propName]: value.value } }
      }, (newData: DynamicRenderData) => {
        // dispatcher: 响应式数据更新后触发
        return genRenderPayloads(chip, newData)
      }, {
        collectOnly: true, // 首次仅做依赖收集但不执行派发逻辑
        scheduler: (job: Job) => {
          // 将渲染更新任务注册到调度系统中
          registerJob(job)
        }
      })

      // 将创建的 effect 存储至当前节点对应 chip context
      if (chip.effects) {
        const lastEffect = chip.effects.previous
        lastEffect.next = {
          effect,
          previous: lastEffect,
          next: chip.effects
        }
      } else {
        chip.effects = {
          effect,
          previous: chip.effects,
          next: chip.effects
        }
      }
    }

    // 将属性插入对应的 dom 节点
    if (elm) {
      elm.setAttribute(propName, value)
    }
  }
}

// 完成 component 类型节点的渲染工作: 当前节点插入父 dom 容器
export function completeRenderWorkForComponent(chip: Chip) {

}

// 完成虚拟容器类型节点的渲染工作: 当前节点插入父 dom 容器
export function completeRenderWorkForVirtualChip(chip: Chip) {
  // TODO 确认 virtual chip 是否还需要在 complete 阶段处理事情

  // const { source, render } = chip.instance
  // // 建立动态数据与渲染 effect 之间的关系
  // effect<DynamicRenderData>(() => {
  //   // collector: 触发当前注册 effect 的收集行为
  //   const rawSource = createEmptyObject()
  //   for (const k in source) {
  //     rawSource[k] = source[k].value
  //   }

  //   return {
  //     childrenRenderer: {
  //       render,
  //       source: rawSource
  //     }
  //   }
  // }, (newData: DynamicRenderData) => {
  //   // dispatcher: 响应式数据更新后触发
  //   return genRenderPayloads(chip, newData)
  // }, {
  //   collectOnly: true, // 首次仅做依赖收集但不执行派发逻辑
  //   scheduler: (job: Job) => {
  //     // 将渲染更新任务注册到调度系统中
  //     registerJob(job)
  //   }
  // })
}

// 完成 chip 节点的渲染工作: 将 chip 挂载到 dom 视图上 (仅进行内存级别的 dom 操作)
export function completeRenderWorkForChipSync(chipRoot: ChipRoot, chip: Chip): void {
  switch (chip.chipType) {
    case ChipTypes.NATIVE_DOM:
      completeRenderWorkForElement(chip)
      break
    case ChipTypes.CUSTOM_COMPONENT:
      completeRenderWorkForComponent(chip)
      break
    case ChipTypes.CONDITION:
    case ChipTypes.FRAGMENT:
      completeRenderWorkForVirtualChip(chip)
      break
    default:
      // nuker doesn't have this node type, a bug maybe occurred
      break
  }
}

export function completeRenderWorkForChipConcurrent(chipRoot: ChipRoot, chip: Chip): void {

}

// 创建渲染信息描述 payload
export function createRenderPayloadNode(
  container: Element,
  parentContainer: Element,
  anchorContainer: Element | null,
  type: number,
  context: Chip,
  tag?: string,
  props?: Record<string | number | symbol, any>
): RenderPayloadNode {
  return {
    [RenderFlags.IS_RENDER_PAYLOAD]: true,
    context,
    type,
    tag,
    props,
    next: null,
    container,
    parentContainer,
    anchorContainer
  }
}

// 生成更新描述信息
export function genRenderPayloads(chip: Chip, renderData: DynamicRenderData): RenderPayloadNode {
  // renderData 是最新的渲染数据，可以是常规的动态属性、动态数据生成的全新子节点 chip
  // 常规属性只有 props 部分，如果是动态数据生成的子节点，则会有 childrenRenderer 部分
  // props 描述动态属性，childrenRenderer 描述动态子节点 (通常是动态数据生成的非稳定 dom 结构子树)
  const { props, children } = renderData
  const { elm, tag } = chip
  let type = RenderUpdateTypes.PATCH_PROP
  if (children) {
    // 处理动态子节点，生成动态子节点的 RenderPayloadNode
    const newChip = cloneChip(chip, props, children)
    // trigger diff
    performReconcileWork(chip, newChip)
    type = RenderUpdateTypes.PATCH_CHILDREN
  }

  const payload = createRenderPayloadNode(
    elm,
    chip.parent.elm,
    null,
    type,
    chip,
    (tag as string),
    props
  )
  currentRenderPayload = currentRenderPayload.next = payload
  return payload
}

// diff 执行入口函数
export function performReconcileWork(oldChip: Chip, newChip: Chip): void {
  try {
    newChip.wormhole = oldChip
    registerOngoingReconcileWork(newChip, newChip)
  } catch (e) {

  }
}

// 将单个成对节点的 reconcile 作为任务单元注册进调度系统
export function registerOngoingReconcileWork(subRoot: Chip, chip: Chip): void {
  registerJob(() => {
    const next: Chip = reconcile(chip)
    if (next && next[ChipFlags.IS_CHIP]) {
      // 为下一组 reconcile 的节点注册任务
      registerOngoingReconcileWork(subRoot, next)
    } else if (next === null) {
      // 当前渲染周期内的所有 reconcile 任务全部执行完毕，注册 commit 任务
      // commit 为单一同步任务，一旦开始执行便不可中断
      registerJob(() => {
        commitRenderPayloads(subRoot.renderPayloads)
      })
    }
  })
}

// 每个节点的 diff 作为一个任务单元，且任务之间支持被调度系统打断、恢复
export function reconcile(chip: Chip): Chip {
  let nextChip: Chip
  ongoingChip = chip
  switch (chip.phase) {
    case ChipPhases.PENDING:
      const children: ChipChildren = chip.children
      const firstChild: Chip = getFirstChipChild(children)

      chip.phase = ChipPhases.INITIALIZE

      if (firstChild) {
        chip.firstChild = firstChild
        firstChild.parent = chip
        // 建立新旧 chip 子节点之间的映射关系，便于 chip-tree 回溯阶段
        // 通过新旧节点间的映射关系进行节点对的 diff
        const oldChildren: ChipChildren = chip.wormhole.children
        mapChipChildren(oldChildren, children)
        nextChip = firstChild
      } else {
        nextChip = completeReconcile(chip)
      }

      break
    case ChipPhases.INITIALIZE:
      nextChip = completeReconcile(chip)
      break
  }

  return nextChip
}

// 完成 chip 节点的 reconcile 工作
export function completeReconcile(chip: Chip): Chip {
  ongoingChip = chip
  chip.phase = ChipPhases.COMPLETE

  // diff 出更新描述 RenderPayload
  reconcileToGenRenderPayload(chip)

  // 获取下一个需要处理的 chip
  let sibling: Chip = chip.nextSibling
  return sibling ? sibling : chip.parent
}

// 建立 chip 子节点之间的映射关系
export function mapChipChildren(oldChildren: ChipChildren, newChildren: ChipChildren): void {

}

// 新旧 chip diff 生成更新描述
export function reconcileToGenRenderPayload(chip: Chip): RenderPayloadNode {

}

export function mount(oldChip: Chip, newChip: Chip, anchor: Element): void {
  if (newChip.chipType === ChipTypes.FRAGMENT) {

  } else if (newChip[ChipFlags.IS_CHIP]) {
    const { context } = oldChip
    const { tag, props } = newChip
    currentRenderPayload.next = createRenderPayloadNode(
      null,
      null,
      null,
      RenderUpdateTypes.MOUNT,
      context,
      (tag as string),
      props
    )
  }
}

export function unmount(chip: Chip): void {
  if (chip.chipType === ChipTypes.FRAGMENT) {
    const children = (chip.children as Chip[])
    for (let i = 0; i < children.length; i++) {
      unmount(children[i])
    }
  } else if (chip[ChipFlags.IS_CHIP]) {
    const { elm, context } = chip
    const parentContainer: Element = domOptions.parentNode(elm)
    currentRenderPayload.next = createRenderPayloadNode(
      elm,
      parentContainer,
      null,
      RenderUpdateTypes.UNMOUNT,
      context
    )
  }
}
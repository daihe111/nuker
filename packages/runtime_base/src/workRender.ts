import { Chip, ChipRoot, ChipUnit, ChipPhases } from "./chip";
import { genBaseListNode, isArray, isNumber, isString, isObject, isFunction } from "../../share/src";
import { VNode, VNodeChildren, UnitTypes, VNodeFlags, getFirstVNodeChild, VNodePropNode } from "./vnode";
import { registerJob, Job } from "./scheduler";
import { ComponentInstance, Component, createComponentInstance, reuseComponentInstance } from "./component";
import { domOptions } from "./domOptions";
import { effect } from "../../reactivity/src/effect";

export interface ChildrenRenderer {
  source: any
  render: (source: any) => VNodeChildren
}

export interface DynamicRenderData {
  props: Record<string | number | symbol, any>
  childrenRenderer: ChildrenRenderer
}

export interface RenderPayload {
  type: number
  container?: Node
  parentContainer?: Node
  anchorContainer?: Node | null
  tag?: string
  props: Record<string | number | symbol, any>
  childPayloads?: RenderPayload[] | null
}

export const enum RenderModes {
  SYNCHRONOUS = 0,
  CONCURRENT = 1
}

export const enum RenderUpdateTypes {
  PATCH_PROP = 0,
  PATCH_CHILDREN = 1,
  MOUNT = 2,
  UNMOUNT = 3,
  REPLACE = 4,
  MOVE = 5
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

    let firstChild = chip.firstChild
    if (!firstChild) {
      const firstVNodeChild = getFirstVNodeChild(chip.children)
      chip.firstChild = firstChild = createChipFromVNode(firstVNodeChild)
      if (firstChild) {
        firstChild.parent = chip
        chip.currentChildIndex = 0
        return firstChild
      } else {
        return completeChip(chipRoot, chip, mode)
      }
    }
  } else if (chip.phase === ChipPhases.INITIALIZE) {
    // 该节点在 dive | swim 阶段已经遍历过，此时为祖先节点回溯阶段
    genMutableEffects(chipRoot, chip, mode)
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
    case UnitTypes.RESERVED_COMPONENT:
      initRenderWorkForReservedComponent(chip)
      break
    case UnitTypes.NATIVE_DOM:
      initRenderWorkForElement(chip)
      break
    case UnitTypes.CONDITION:
      initRenderWorkForCondition(chip)
      break
    case UnitTypes.FRAGMENT:
      initRenderWorkForFragment(chip)
      break
  }
}

// chip 是 leaf node，完成对该节点的所有处理工作，并标记为 complete
// 返回下一个要处理的 chip 节点
export function completeChip(chipRoot: ChipRoot, chip: Chip, mode: number): Chip {
  chip.phase = ChipPhases.COMPLETE
  genMutableEffects(chipRoot, chip, mode)
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

// 初始化 nuker 内置 component 类型节点的渲染工作
export function initRenderWorkForReservedComponent(chip: Chip): void {

}

// 初始化 element 类型节点的渲染工作: dom 容器创建
export function initRenderWorkForElement(chip: Chip) {
  const { tag, isSVG, is } = chip
  chip.elm = domOptions.createElement(tag, isSVG, is)
}

// 初始化 condition 类型节点的渲染工作
export function initRenderWorkForCondition(chip: Chip): void {

}

// 初始化 fragment 类型节点的渲染工作
export function initRenderWorkForFragment(chip: Chip): void {

}

// 完成 element 类型节点的渲染工作: 当前节点插入父 dom 容器
export function completeRenderWorkForElement(chip: Chip) {
  const parentElm = chip.parent.elm
  const elm = chip.elm
  if (parentElm && elm) {
    parentElm.appendChild(elm)
  }

  // 检索当前 element 节点的属性，区分动态属性和静态属性
  const props = chip.props
  const dynamicProps = new Map<string, any>()
  for (const propName in props) {
    const { isDynamic, value } = (props[propName] as VNodePropNode)
    if (isDynamic) {
      // 收集动态属性，动态属性的 value 是 wrapper 化的，避免
      // 访问属性 value 时是立即执行的
      dynamicProps.set(propName, value)

      // 针对当前 chip 节点的动态属性创建对应的渲染 effect
      effect<DynamicRenderData>(() => {
        // collector: 触发当前注册 effect 的收集行为
        return value.value
      }, (newData: DynamicRenderData) => {
        // dispatcher: 响应式数据更新后触发，会
        return genRenderPayload(chip, newData)
      }, {
        collectOnly: true, // 首次仅做依赖收集但不执行派发逻辑
        scheduler: (job: Job) => {
          // 将渲染更新任务注册到调度系统中
          registerJob(job)
        }
      })
    }

    // 将属性插入对应的 dom 节点
    if (elm) {
      elm.setAttribute(propName, value.value)
    }
  }
}

// 完成 component 类型节点的渲染工作: 当前节点插入父 dom 容器
export function completeRenderWorkForComponent(chip: Chip) {

}

// 完成 condition 类型节点的渲染工作: 当前节点插入父 dom 容器
export function completeRenderWorkForCondition(chip: Chip) {

}

// 完成 fragment 类型节点的渲染工作: 当前节点插入父 dom 容器
export function completeRenderWorkForFragment(chip: Chip) {

}

// 完成 chip 节点的渲染工作: 将 chip 挂载到 dom 视图上 (仅进行内存级别的 dom 操作)
export function completeRenderWorkForChipSync(chipRoot: ChipRoot, chip: Chip): void {
  switch (chip.unitType) {
    case UnitTypes.NATIVE_DOM:
      completeRenderWorkForElement(chip)
      break
    case UnitTypes.CUSTOM_COMPONENT:
      completeRenderWorkForComponent(chip)
      break
    case UnitTypes.CONDITION:
      completeRenderWorkForCondition(chip)
      break
    case UnitTypes.FRAGMENT:
      completeRenderWorkForFragment(chip)
      break
    default:
      // nuker doesn't have this node type, a bug maybe occurred
      break
  }
}

export function completeRenderWorkForChipConcurrent(chipRoot: ChipRoot, chip: Chip): void {

}

// 创建渲染信息描述 payload
export function createRenderPayload(
  tag: string,
  props: Record<string | number | symbol, any>,
  childPayloads: RenderPayload[],
  container: Node,
  parentContainer: Node,
  anchorContainer: Node | null,
  type: number
): RenderPayload {
  return {
    type,
    tag,
    props,
    childPayloads,
    container,
    parentContainer,
    anchorContainer
  }
}

// 生成更新描述信息
export function genRenderPayload(chip: Chip, renderData: DynamicRenderData): RenderPayload {
  // renderData 是最新的渲染数据，可以是常规的动态属性、动态数据生成的全新子节点 vnode
  // 常规属性只有 props 部分，如果是动态数据生成的子节点，则会有 childrenRenderer 部分
  // props 描述动态属性，childrenRenderer 描述动态子节点 (通常是动态数据生成的非稳定 dom 结构子树)
  const { props, childrenRenderer } = renderData
  const { elm, tag } = chip
  let childPayloads = null
  let type = RenderUpdateTypes.PATCH_PROP
  if (isObject(childrenRenderer)) {
    // 处理动态子节点，生成动态子节点的 renderPayload
    const { source, render } = childrenRenderer
    if (isFunction(render)) {
      const oldChildren: VNodeChildren = chip.children
      const newChildren: VNodeChildren = render(source)
      // children diff
      childPayloads = reconcileChildrenSequence(oldChildren, newChildren)
      type = RenderUpdateTypes.PATCH_CHILDREN
    }
  }

  return createRenderPayload(tag as string, props, childPayloads, elm, chip.parent.elm, null, type)
}

// 对新旧动态子节点序列进行 diff，靶向生成需要触发的更新 payloads
export function reconcileChildrenSequence(oldChildren: VNodeChildren, newChildren: VNodeChildren): RenderPayload[] {
  // inferno diff
  
}
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
  createChip,
  ChipProps
} from "./chip";
import { genBaseListNode, isArray, isNumber, isString, isObject, isFunction, createEmptyObject } from "../../share/src";
import { registerJob, Job, RegisterModes, JobPriorities } from "./scheduler";
import { ComponentInstance, Component, createComponentInstance, reuseComponentInstance } from "./component";
import { domOptions } from "./domOptions";
import { effect, disableCollecting, enableCollecting, Effect } from "../../reactivity/src/effect";
import { performCommitWork, commitProps, PROP_TO_DELETE } from "./commit";
import { createVirtualChipInstance, VirtualInstance } from "./virtualChip";
import { CompileFlags } from "./compileFlags";
import { pushRenderEffectToBuffer, RenderEffectTypes, RenderEffectFlags } from "./renderEffectBuffer";
import { ReactiveTypes } from "../../reactivity/src/reactive";

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

// 框架渲染模式
export const enum RenderModes {
  SYNCHRONOUS = 0, // 同步渲染模式
  CONCURRENT = 1 // 异步并发渲染模式
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

// 正在进行中的 chip 节点
let ongoingChip: ChipUnit = null
// 当前正在执行渲染工作的组件 instance
let currentRenderingInstance: ComponentInstance = null
// 当前正在生成的 RenderPayloadNode
let currentRenderPayload: RenderPayloadNode
let currentRenderMode: number
const renderModeStack: number[] = []

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

// 更新当前渲染模式标记位
export function pushRenderMode(renderMode: number): number {
  renderModeStack.push(renderMode)
  currentRenderMode = renderMode
  return renderMode
}

// 废弃当前渲染模式标记位，并恢复到上一个渲染模式标记位
export function popRenderMode(): number {
  renderModeStack.pop()
  currentRenderMode = renderModeStack[renderModeStack.length - 1]
  return currentRenderMode
}

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

export function registerOngoingChipWork(chipRoot: ChipRoot, chip: Chip): void {
  function chipPerformingJob(chipRoot: ChipRoot, chip: Chip): Function {
    // get next chip to working
    const next = performChipWork(chipRoot, chip, RenderModes.CONCURRENT)
    if (next && next[ChipFlags.IS_CHIP]) {
      return () => {
        return chipPerformingJob(chipRoot, next)
      }
    } else {
      return null
    }
  }

  registerJob(chipPerformingJob.bind(null, chipRoot, chip))
}

// chip unit work 执行
export function performChipWork(chipRoot: ChipRoot, chip: Chip, mode: number): Chip {
  if (chip === null) {
    return null
  }

  if (chip.phase === ChipPhases.PENDING) {
    // 首次遍历处理当前 chip 节点
    initRenderWorkForChip(chip, chipRoot)
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
export function initRenderWorkForChip(chip: Chip, chipRoot: ChipRoot) {
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
      initRenderWorkForConditionChip(chip, chipRoot)
    case ChipTypes.FRAGMENT:
      initRenderWorkForIterableChip(chip, chipRoot)
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

// 初始化条件类型节点的渲染工作
// if-chip: 数据变化时触发整个 render 重新执行
// (source, sourceKey) => {
//   return source[sourceKey[0]] === 1 ? <A /> : (source[sourceKey[1]] === 2 ? <B /> : <C />)
// }
export function initRenderWorkForConditionChip(chip: Chip, chipRoot: ChipRoot): void {
  const {
    render, // chip 节点渲染器
    source, // 响应式数据源
    sourceKey // render 执行时需访问的 key
  } = (chip.instance as VirtualInstance) = createVirtualChipInstance(chip)
  effect<DynamicRenderData>(() => {
    const children: ChipChildren = render(source, sourceKey)
    chip.children = children
    return { children }
  }, (newData: DynamicRenderData, ctx: Effect) => {
    // 新旧 children 进行 reconcile
    return genRenderPayloads(
      chip,
      chipRoot,
      newData,
      ctx[RenderEffectFlags.END_IN_LOOP]
    )
  }, {
    whiteList: (source as object[]).map((s, i) => ({
      source: s,
      key: (sourceKey as unknown[])[i]
    })),
    collectOnly: true,
    scheduler: pushRenderEffectToBuffer
  })
}

// 初始化可遍历类型节点的渲染工作
// for-chip: 每个单元节点均对应一个单元渲染器 render，并且是深度收集
// case 1: iterable source 直接全量被替换，重新执行 render 生成新的
//   全新节点片段，并与旧的节点片段做 reconcile
// case 2: iterable source 本身引用不变，对一级子元素做改变，只需要对
//   一级元素改变的 key 对应的子 render 进行新节点生成，并对新旧节点对
//   进行 reconcile
// case 3: iterable source 本身引用不变，对一级以下元素做改变，此情况
//   下发生值变化的数据所对应的 dom 结构一定是稳定的，无需特殊处理
// for-chip 编译出的渲染器
export function initRenderWorkForIterableChip(chip: Chip, chipRoot: ChipRoot): void {
  const {
    source, // 响应式数据源
    sourceKey, // 如果存在父级数据源，则当前 iterable chip 需要通过 sourceKey 访问可遍历源数据
    render // 模板渲染器
  } = (chip.instance as VirtualInstance) = createVirtualChipInstance(chip)

  // 创建源数据一级子元素的渲染 effect 收集
  function genEffectOfSon(source: object, key: string, render: Function): Chip {
    let ret: Chip
    let lastChildren: Chip
    effect<DynamicRenderData>(() => {
      ret = render(source[key])
      return { children: ret }
    }, (newData: DynamicRenderData, ctx: Effect) => {
      const children: Chip = (newData.children as Chip)
      performReconcileWork(lastChildren, children, chipRoot, ctx[RenderEffectFlags.END_IN_LOOP])
      lastChildren = children
    }, {
      whiteList: [{ source, key }],
      collectOnly: true,
      scheduler: pushRenderEffectToBuffer,
      effectType: RenderEffectTypes.NEED_SCHEDULE
    })

    return ret
  }

  if (sourceKey) {
    // 数据源为从属于上级响应式数据源的响应式数据，因此该数据源可被
    // 完全改变 (引用级)，数据源引用改变后需要根据新的数据源生成 chip
    // 片段，并对新旧 chip 片段进行 reconcile
    effect<DynamicRenderData>(() => {
      const children: Chip[] = []
      const src = source[sourceKey as any]
      for (const key in (src as object)) {
        children.push(genEffectOfSon(src, key, render))
      }
      // 更新 chip 对应的 children，以便进行子代 chip 的深度遍历
      chip.children = children
      return { children }
    }, (newData: DynamicRenderData, ctx: Effect) => {
      // TODO 生成 chip 更新任务并缓存，等待 idle 阶段执行
      return genRenderPayloads(
        chip,
        chipRoot,
        newData,
        ctx[RenderEffectFlags.END_IN_LOOP]
      )
    }, {
      whiteList: [{ source, key: sourceKey }],
      collectOnly: true, // 首次仅做依赖收集但不执行派发逻辑
      scheduler: pushRenderEffectToBuffer, // 将渲染更新任务推入渲染任务缓冲区
      effectType: RenderEffectTypes.NEED_SCHEDULE
    })
  } else {
    // 仅数据源本身为响应式数据，因此数据源自身无法被直接修改，仅
    // 需要对子代数据进行依赖收集
    const children: Chip[] = []
    for (const key in (source as object)) {
      children.push(genEffectOfSon(source, key, render))
    }
    chip.children = children
  }
}

// 完成 element 类型节点的渲染工作: 当前节点插入父 dom 容器
export function completeRenderWorkForElement(chip: Chip, chipRoot: ChipRoot) {
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
      }, (newData: DynamicRenderData, ctx: Effect) => {
        // dispatcher: 响应式数据更新后触发
        return ctx[RenderEffectFlags.RENDER_MODE] === RenderModes.SYNCHRONOUS ?
          commitProps(chip.elm, newData.props) :
          genRenderPayloads(chip, chipRoot, newData)
      }, {
        collectOnly: true, // 首次仅做依赖收集但不执行派发逻辑
        scheduler: !chipRoot.isStable && ((job: Effect) => {
          // 将当前 effect 推入渲染任务缓冲区
          pushRenderEffectToBuffer(job)
        }),
        effectType: RenderEffectTypes.CAN_DISPATCH_IMMEDIATELY
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

export function completeRenderWorkForIterableChip(chip: Chip, chipRoot: ChipRoot): void {
  
}

export function completeRenderWorkForConditionChip(chip: Chip, chipRoot: ChipRoot): void {

}

// 完成 component 类型节点的渲染工作: 当前节点插入父 dom 容器
export function completeRenderWorkForComponent(chip: Chip) {

}

// 完成 chip 节点的渲染工作: 将 chip 挂载到 dom 视图上 (仅进行内存级别的 dom 操作)
export function completeRenderWorkForChipSync(chipRoot: ChipRoot, chip: Chip): void {
  switch (chip.chipType) {
    case ChipTypes.NATIVE_DOM:
      completeRenderWorkForElement(chip, chipRoot)
      break
    case ChipTypes.CUSTOM_COMPONENT:
      completeRenderWorkForComponent(chip)
      break
    case ChipTypes.CONDITION:
      completeRenderWorkForConditionChip(chip, chipRoot)
    case ChipTypes.FRAGMENT:
      completeRenderWorkForIterableChip(chip, chipRoot)
      break
    default:
      // nuker doesn't have this node type, a bug maybe occurred
      break
  }
}

export function completeRenderWorkForChipConcurrent(chipRoot: ChipRoot, chip: Chip): void {

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
export function genRenderPayloads(
  chip: Chip,
  chipRoot: ChipRoot,
  renderData: DynamicRenderData,
  needHooks?: boolean
): void {
  // renderData 是最新的渲染数据，可以是常规的动态属性、动态数据生成的全新子节点 chip
  // 常规属性只有 props 部分，如果是动态数据生成的子节点，则会有 childrenRenderer 部分
  // props 描述动态属性，childrenRenderer 描述动态子节点 (通常是动态数据生成的非稳定 dom 结构子树)
  const { props, children } = renderData
  const { elm, tag } = chip
  let type = RenderUpdateTypes.PATCH_PROP
  if (children) {
    // 处理动态子节点，生成动态子节点的 RenderPayloadNode
    const newChip = cloneChip(chip, props, children)
    // trigger reconcile diff
    performReconcileWork(chip, newChip, chipRoot, needHooks)
    type = RenderUpdateTypes.PATCH_CHILDREN
  }

  registerJob(
    () => {
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
    },
    JobPriorities.NORMAL,
    null,
    0,
    needHooks && {
      hooks: {
        onCompleted: performCommitWork.bind(null, chipRoot)
      }
    }
  )
}

// diff 执行入口函数
export function performReconcileWork(
  oldChip: Chip,
  newChip: Chip,
  chipRoot: ChipRoot,
  needHooks?: boolean
): void {
  try {
    newChip.wormhole = oldChip
    registerOngoingReconcileWork(newChip, chipRoot, needHooks)
  } catch (e) {

  }
}

// 将 chip 节点对的 reconcile 作为任务单元注册进调度系统，
// 每个任务返回下一 chip 节点对做 reconcile 的子任务，以此类推
export function registerOngoingReconcileWork(
  chip: Chip,
  chipRoot: ChipRoot,
  needHooks: boolean
): void {
  function reconcileJob(chip: Chip): Function {
    const next: Chip = reconcile(chip)
    if (next && next[ChipFlags.IS_CHIP]) {
      return () => {
        return reconcileJob(next)
      }
    } else {
      return null
    }
  }

  registerJob(
    reconcileJob.bind(null, chip),
    JobPriorities.NORMAL,
    null,
    0,
    needHooks && {
      hooks: {
        onCompleted: performCommitWork.bind(null, chipRoot)
      }
    }
  )
}

/**
 * 检测 chip 的 reconcile 是否需要跳过
 * @param chip
 */
export function isSkipReconcile(chip: Chip): boolean {
  const { compileFlags } = chip
  const isStatic = compileFlags & CompileFlags.STATIC
  return (isStatic && currentRenderingInstance.chip?.chipType !== ChipTypes.CONDITION)
}

// 每个节点的 diff 作为一个任务单元，且任务之间支持被调度系统打断、恢复
export function reconcile(chip: Chip): Chip {
  let nextChip: Chip
  ongoingChip = chip
  switch (chip.phase) {
    case ChipPhases.PENDING:
      // 1. 首次遍历
      // 首次遍历 chip 节点时判断该节点是否为可跳过 diff 的静态节点，
      // 如果可跳过，则不再对该 chip 做深度遍历，直接跳至下一个待处理 chip
      if (isSkipReconcile(chip)) {
        nextChip = completeReconcile(chip, true)
      }
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
      // 2. 回溯
      nextChip = completeReconcile(chip)
      break
  }

  return nextChip
}

// 完成 chip 节点的 reconcile 工作
export function completeReconcile(chip: Chip, isSkipable: boolean = false): Chip {
  ongoingChip = chip
  chip.phase = ChipPhases.COMPLETE

  // 如果 chip 节点不跳过，则 diff 出更新描述 render payload
  if (!isSkipable) {
    reconcileToGenRenderPayload(chip)
  }

  // 根据收集的待删除子节点生成对应的 render payload
  if (hasDeletions(chip)) {
    genRenderPayloadsForDeletions(chip.deletions)
  }

  // 获取下一个需要处理的 chip
  let sibling: Chip = chip.nextSibling
  if (sibling === null) {
    // 尝试创建有效 sibling 节点
    const parent: Chip = chip.parent
    sibling = parent?.children[++parent.currentChildIndex]
    if (sibling !== null) {
      chip.nextSibling = sibling
      sibling.prevSibling = chip
    }
  }

  if (sibling) {
    sibling.parent = chip.parent
    return sibling
  } else {
    return chip.parent
  }
}

// 建立 chip 子节点之间的映射关系，但不引入其他副作用，生成 render payload
// 需要在独立的时机去做，避免任务单元变得 CPU-bound
export function mapChipChildren(oldChildren: ChipChildren, newChildren: ChipChildren): void {

}

// 缓存要删除的 chip
export function cacheDeletions(parent: Chip, deletion: Chip): void {
  if (!isArray(parent.deletions)) {
    parent.deletions = []
  }

  parent.deletions.push(deletion)
}

export function hasDeletions(chip: Chip): boolean {
  return isArray(chip.deletions)
}

// 新旧 chip (仅 chip 节点本身) diff 生成更新描述
// 配对方式有以下几种:
// · 类型、key 均相同的相似节点
// · 旧节点为 null，新节点为有效节点
// TODO 需删除的旧节点在 diff 过程中创建渲染描述
export function reconcileToGenRenderPayload(chip: Chip): RenderPayloadNode {
  const { tag, props, wormhole, elm } = chip
  if (chip.wormhole) {
    // 有匹配的旧节点，且新旧 chip 节点一定是相似节点
    const propsToPatch: object = reconcileProps(props, wormhole?.props)
    currentRenderPayload = currentRenderPayload.next = createRenderPayloadNode(
      elm,
      null,
      null,
      RenderUpdateTypes.PATCH_PROP,
      chip,
      (tag as string),
      propsToPatch
    )
  } else {
    // 无匹配到的旧 chip 节点，新 chip 为待挂载节点
    currentRenderPayload = currentRenderPayload.next = createRenderPayloadNode(
      elm,
      domOptions.parentNode(elm),
      null, // TODO anchor 解析逻辑待补充
      RenderUpdateTypes.MOUNT,
      chip,
      (tag as string),
      props
    )
  }
  
  return currentRenderPayload
}

// 根据缓存的待删除子节点生成对应的 render payload
export function genRenderPayloadsForDeletions(deletions: Chip[]): void {
  for (let i = 0; i < deletions.length; i++) {
    const deletion = deletions[i]
    const elm = deletion.elm
    currentRenderPayload = currentRenderPayload.next = createRenderPayloadNode(
      elm,
      domOptions.parentNode(elm),
      null,
      RenderUpdateTypes.UNMOUNT,
      deletion
    )
  }
}

/**
 * 两组 props diff 生成变化 prop 的集合
 * @param newProps 
 * @param oldProps 
 */
export function reconcileProps(newProps: ChipProps, oldProps: ChipProps): Record<string, any> {
  const ret = createEmptyObject()
  // 遍历新 props，找出需要 patch 的 prop
  for (const propName in newProps) {
    const value = newProps[propName]?.value
    if (propName in oldProps) {
      if (value !== oldProps[propName]?.value) {
        ret[propName] = value
      }
    } else {
      ret[propName] = value
    }
  }

  // 遍历旧 props，将在新 props 中已经不存在的属性作为待删除项添加到返回结果中
  for (const propName in oldProps) {
    if (propName in newProps) {
      continue
    }

    ret[propName] = PROP_TO_DELETE
  }

  return ret
}
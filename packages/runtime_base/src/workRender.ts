import {
  Chip,
  ChipRoot,
  ChipPhases,
  ChipChildren,
  ChipTypes,
  ChipFlags,
  cloneChip,
  ChipProps,
  getLastChipChild,
  DynamicValueGetter,
  ChipEffectUnit,
  StaticValue,
  getPropLiteralValue,
  getPointerChip,
  createChipRoot,
  createChip
} from "./chip";
import { isArray, isFunction, createEmptyObject, extend, isString, isNumber, EMPTY_OBJ } from "../../share/src";
import {
  registerJob,
  initScheduler
} from "./scheduler";
import { ComponentInstance, Component, createComponentInstance } from "./component";
import { domOptions } from "./domOptions";
import { effect, disableCollecting, enableCollecting, Effect } from "../../reactivity/src/effect";
import { performCommitWork, commitProps, PROP_TO_DELETE } from "./commit";
import { createVirtualChipInstance, VirtualInstance, VirtualChipRender } from "./virtualChip";
import { CompileFlags } from "./compileFlags";
import { pushRenderEffectToBuffer, RenderEffectTypes, initRenderEffectBuffer } from "./renderEffectBuffer";
import {
  cacheIdleJob,
  replaceChipContext,
  performIdleWork,
  teardownChipCache,
  teardownAbandonedEffects,
  teardownDeletion
} from "./idle";
import { invokeLifecycle, LifecycleHooks, HookInvokingStrategies, registerLifecycleHook } from "./lifecycle";
import { currentEventPriority } from "../../runtime_dom/src/event";

export type AppContent = | Component

export interface ReconcileChipPair {
  oldChip: Chip | null
  newChip: Chip | null
}

export interface ChildrenRenderer {
  source?: any
  render: (source?: any) => ChipChildren
}

export interface DynamicRenderData {
  props?: Record<string | number | symbol, any>
  children?: ChipChildren
}

export const enum RenderFlags {
  IS_RENDER_PAYLOAD = '__n_isRenderPayload'
}

export interface NukerRenderOptions {
  renderMode: number
  mutableHookStrategy: number
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
  props?: Record<string | number | symbol, any>
  context: Chip // 当前 render payload 所属 chip 上下文
  auxiliaryContext?: Chip // 辅助 chip 上下文
  callback?: Function // render payload commit 之后要执行的回调

  // pointers
  next: RenderPayloadNode | null
}

// 框架挂载模式
export const enum MountModes {
  SYNCHRONOUS = 0, // 同步挂载模式
  CONCURRENT = 1 // 异步并发挂载模式
}

export const enum RenderUpdateTypes {
  PATCH_PROP = 1, // 更新属性
  PATCH_CHILDREN = 1 << 1, // 更新子节点
  CREATE_ELEMENT = 1 << 2, // 创建空的 dom 容器
  MOUNT = 1 << 3, // 挂载指定的 dom 节点
  UNMOUNT = 1 << 4, // 卸载指定的 dom 节点
  REPLACE = 1 << 5, // dom 节点替换
  MOVE = 1 << 6, // dom 节点位置移动
  INVALID = -1 // 无效的更新类型
}

export const enum ReconcilingCellStatuses {
  CHILD_MAY_SKIP = 0, // 子代节点的 reconcile 可能跳过
  FULL_RECONCILE = 1 // 子代节点需要做无差别全量 reconcile
}

export const enum NukerRenderModes {
  // nuker 的默认全局渲染模式
  // 每个 event loop 结束时批量执行当前 event loop 收集的渲染任务，所有渲染任务
  // 一次性同步执行完，中途不可打断
  BATCH_SYNC = 0,
  // 渲染任务支持时间切片，但无优先级调度，渲染任务按照注册时间依次执行
  // 不使用 js event loop & scheduler 双调度的原因:
  // 1. 跨调度器通信困难，彼此信息不共享，每条调度线都无法取得对另一条
  //    调度线的完全控制权，比如我们无法感知到，在 scheduler 两个相邻时
  //    间片之间 js event loop 线的渲染任务执行情况
  // 2. 不同调度线的任务之间可能相互插入耦合，不利于任务的控制、追踪
  TIME_SPLICING = 1,
  // 并发渲染模式，根据每个渲染副作用的优先级进行调度，决定渲染任务执行的时机、顺序、行为
  CONCURRENT = 2
}

export let currentRenderingInstance: ComponentInstance | VirtualInstance = null // 当前正在执行渲染工作的组件 instance
export let renderMode: number = NukerRenderModes.TIME_SPLICING // 框架的渲染模式
let mutableHookStrategy: number // UI 变化后生命周期的触发策略

/**
 * nuker 框架渲染总入口方法
 * @param appContent 
 * @param container 
 * @param rm 
 */
export function render(
  appContent: AppContent,
  container: Element | string,
  { renderMode: rm, mutableHookStrategy: mhs }: NukerRenderOptions
): Element {
  renderMode = isNumber(rm) ? rm : NukerRenderModes.TIME_SPLICING
  mutableHookStrategy = isNumber(mhs) ? mhs : HookInvokingStrategies.ON_IDLE
  const chip: Chip = createChip(appContent)
  const chipRoot: ChipRoot = createChipRoot(chip)
  if (renderMode === NukerRenderModes.BATCH_SYNC) {
    initRenderEffectBuffer({
      onFlushed: () => {
        performCommitWork(chipRoot)
        performIdleWork(chipRoot)
      }
  })
  } else {
    initScheduler({
      ...rm === NukerRenderModes.CONCURRENT ? {
        // 批同步任务开始收敛前重置全局渲染缓存信息
        onConvergentJobsStarted: teardownChipCache.bind(null, chipRoot),
        // 批同步任务结束收敛后批量执行 commit 阶段产生的闲时任务，并重置
        // 全局渲染缓存信息
        onConvergentJobsFinished: performIdleWork.bind(null, chipRoot)
      } : {}
    })
  }

  // 执行离屏渲染，渲染完成后将内存中的根节点挂载到指定的 dom 容器中
  const root: Element = performRenderSync(chipRoot, chip)
  container = isString(container) ? domOptions.getElementById(container) : container
  if (container) {
    domOptions.appendChild(root, container)
  }

  return container
}

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

/**
 * 同步执行渲染任务，整个渲染过程为离屏渲染，仅发生在内存中
 * 方法返回渲染之后内存中的 dom 根节点
 * @param chipRoot 
 * @param chip 
 */
export function performRenderSync(chipRoot: ChipRoot, chip: Chip): Element {
  let rootContainer: Element
  let ongoingChip: Chip = chip
  while (ongoingChip !== null) {
    ongoingChip = performChipWork(chipRoot, ongoingChip, MountModes.SYNCHRONOUS)

    if (ongoingChip === null) {
      // 表示 chip 树已回溯至根节点，整颗 chip 树已完成离屏渲染
      rootContainer = chipRoot.root.elm
    }
  }

  // 批量执行当前渲染周期内缓存的所有 mounted 生命周期
  invokeLifecycle(LifecycleHooks.MOUNTED, chipRoot)
  chipRoot[LifecycleHooks.MOUNTED] = null

  return rootContainer
}

/**
 * 以异步可调度的方式执行渲染任务
 * @param chipRoot 
 * @param chip 
 */
export function performRenderConcurrent(chipRoot: ChipRoot, chip: Chip): void {
  registerOngoingChipWork(chipRoot, chip)
}

/**
 * 将 chip 节点树渲染任务注册进调度系统
 * @param chipRoot 
 * @param chip 
 */
export function registerOngoingChipWork(chipRoot: ChipRoot, chip: Chip): void {
  function chipPerformingJob(chipRoot: ChipRoot, chip: Chip): Function {
    // get next chip to working
    const next = performChipWork(chipRoot, chip, MountModes.CONCURRENT)
    if (next && next[ChipFlags.IS_CHIP]) {
      return chipPerformingJob.bind(null, chipRoot, next)
    } else {
      return null
    }
  }

  registerJob(chipPerformingJob.bind(null, chipRoot, chip))
}

/**
 * chip unit work 执行
 * callback 会回传当前 chip 节点挂载后的 dom 容器
 * @param chipRoot 
 * @param chip 
 * @param mode 
 * @param callback 
 */
export function performChipWork(
  chipRoot: ChipRoot,
  chip: Chip,
  mode: number,
  callback?: (chip: Chip) => void
): Chip {
  if (chip === null) {
    return null
  }

  if (chip.phase === ChipPhases.PENDING) {
    // 首次遍历处理当前 chip 节点
    initRenderWorkForChip(chip, chipRoot)
    chip.phase = ChipPhases.INITIALIZE

    // 对于包含动态子节点执行器 render 的 chip，如虚拟容器类型、
    // 组件类型的 chip 节点，init 阶段已经建立了父子关系，因此
    // lastChild 已经有有效 chip 节点
    let lastChild = chip.lastChild
    if (!lastChild) {
      // 无子节点链接，建立父子节点之间的链接
      const children: ChipChildren = chip.children
      const lastChipChild = getLastChipChild(children)
      let next: Chip
      if (lastChipChild) {
        chip.lastChild = lastChild = lastChipChild
        lastChild.parent = chip
        chip.currentChildIndex = isArray(children) ? (children.length - 1) : 0
        next = lastChild
      } else {
        next = completeChip(chipRoot, chip, mode, callback)
      }

      return next
    } else {
      return lastChild
    }
  } else if (chip.phase === ChipPhases.INITIALIZE) {
    // 该节点在 dive | swim 阶段已经遍历过，此时为祖先节点回溯阶段
    return completeChip(chipRoot, chip, mode, callback)
  }
}

/**
 * 为当前 chip 执行可供渲染用的相关准备工作
 * @param chip 
 * @param chipRoot 
 */
export function initRenderWorkForChip(chip: Chip, chipRoot: ChipRoot): void {
  switch (chip.chipType) {
    // 原生节点
    case ChipTypes.NATIVE_DOM:
      initRenderWorkForElement(chip)
      break
    // 非原生节点，附带虚拟容器的节点: component / virtual chip
    case ChipTypes.CUSTOM_COMPONENT:
      initRenderWorkForComponent(chip)
      break
    case ChipTypes.RESERVED_COMPONENT:
      initRenderWorkForReservedComponent(chip)
      break
    case ChipTypes.CONDITION:
      initRenderWorkForConditionChip(chip, chipRoot)
    case ChipTypes.FRAGMENT:
      initRenderWorkForIterableChip(chip, chipRoot)
      break
  }
}

/**
 * chip 是 leaf node，完成对该节点的所有处理工作，并标记为 complete
 * 返回下一个要处理的 chip 节点
 * 同级兄弟节点的处理顺序为从尾到头，以保证靠近尾部的节点优先渲染，渲染
 * 靠近头部的节点时可以获取到后面节点的 dom 作为插入锚点
 * @param chipRoot 
 * @param chip 
 * @param mode 
 * @param callback 
 */
export function completeChip(
  chipRoot: ChipRoot,
  chip: Chip,
  mode: number,
  callback?: (chip: Chip) => void
): Chip {
  chip.phase = ChipPhases.COMPLETE
  dispatchMutableEffects(chipRoot, chip, mode)

  // 计算下一个要处理的节点
  let sibling = chip.prevSibling
  if (sibling === null) {
    // finish dive and start swim to handle sibling node
    const parent = chip.parent
    const children: ChipChildren = parent?.children
    if (isArray(children)) {
      sibling = children[--parent.currentChildIndex]
    }
  }

  if (isFunction(callback)) {
    callback(chip)
  }

  if (sibling) {
    // 当前 chip 有有效的兄弟节点
    chip.prevSibling = sibling
    sibling.parent = chip.parent
    return sibling
  } else {
    return chip.parent
  }
}

/**
 * 根据 chip 节点中纯数据层面信息派发对应的视图渲染行为
 * @param chipRoot 
 * @param chip 
 * @param mode 
 */
export function dispatchMutableEffects(chipRoot: ChipRoot, chip: Chip, mode: number): void {
  switch (mode) {
    case MountModes.SYNCHRONOUS:
      completeRenderWorkForChipSync(chipRoot, chip)
      break
    case MountModes.CONCURRENT:
      completeRenderWorkForChipConcurrent(chipRoot, chip)
      break
    default:
      // an nuker bug maybe has occurred
      break
  }
}

/**
 * 初始化 component 类型节点的渲染工作
 * @param chip 
 */
export function initRenderWorkForComponent(chip: Chip): void {
  const instance: ComponentInstance = createComponentInstance((chip.tag as Component), chip)
  const { source, render } = chip.instance = instance
  // 执行组件的 init 生命周期，此时只能访问到组件实例
  invokeLifecycle(LifecycleHooks.INIT, instance)
  // 此处仅通过 render 渲染器获取组件节点的子节点，不做响应式系统的依赖收集
  disableCollecting()
  chip.children = render(source)
  // 恢复响应式系统的依赖收集
  enableCollecting()
  // 触发 willMount 生命周期，此刻为执行组件渲染挂载工作前的最后时机
  invokeLifecycle(LifecycleHooks.WILL_MOUNT, instance)
}

// 初始化 nuker 内置 component 类型节点的渲染工作
export function initRenderWorkForReservedComponent(chip: Chip): void {

}

// 初始化 element 类型节点的渲染工作: dom 容器创建
export function initRenderWorkForElement(chip: Chip): void {
  const { tag, isSVG, is } = chip
  chip.elm = domOptions.createElement(tag, isSVG, is)
}

// 初始化条件类型节点的渲染工作
// if-chip: 数据变化时触发整个 render 重新执行
// (source, sourceKey) => {
//   return source[sourceKey[0]] === 1 ? <A /> : (source[sourceKey[1]] === 2 ? <B /> : <C />)
// }
export function initRenderWorkForConditionChip(chip: Chip, chipRoot: ChipRoot): void {
  initConditionChip(chip, chipRoot)
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
  initIterableChip(chip, chipRoot)
}

// 完成 element 类型节点的渲染工作: 当前节点插入父 dom 容器
export function completeRenderWorkForElement(chip: Chip, chipRoot: ChipRoot): void {
  // 将当前 chip 对应的实体 dom 元素插入父 dom 容器
  const parentElm: Element = getAncestorContainer(chip)
  const elm = chip.elm
  // TODO 节点挂载顺序为从后向前，因此需指定当前 element 挂载的锚点
  if (parentElm && elm) {
    domOptions.appendChild(elm, parentElm)
  }

  // 检索当前 chip 节点的属性，为 chip 对应的 element 节点挂载属性，
  // 区分动态属性和静态属性
  const props = chip.props
  for (const propName in props) {
    let value = props[propName]
    if (isFunction(value)) {
      // 针对当前 chip 节点的动态属性创建对应的渲染 effect
      createRenderEffectForProp(chip, chipRoot, propName, value)
    }

    // 将属性插入对应的 dom 节点
    if (elm) {
      domOptions.setAttribute(elm, propName, `${value}`)
    }
  }
}

export function completeRenderWorkForIterableChip(chip: Chip, chipRoot: ChipRoot): void {
  mountElementForChip(chip)
}

export function completeRenderWorkForConditionChip(chip: Chip, chipRoot: ChipRoot): void {
  mountElementForChip(chip)
}

/**
 * 完成 component 类型节点的渲染工作: 当前节点插入父 dom 容器
 * @param chip 
 * @param chipRoot 
 */
export function completeRenderWorkForComponent(chip: Chip, chipRoot: ChipRoot): void {
  mountElementForChip(chip)

  // 执行 mounted 生命周期，此时组件已执行完自身的渲染挂载工作
  if (mutableHookStrategy === HookInvokingStrategies.ON_IDLE) {
    registerLifecycleHook(
      chipRoot,
      LifecycleHooks.MOUNTED,
      chip.instance[LifecycleHooks.MOUNTED]
    )
  } else {
    // 组件自身渲染完成后立即执行 mounted 生命周期
    invokeLifecycle(LifecycleHooks.MOUNTED, (chip.instance as ComponentInstance))
  }
}

/**
 * 完成 chip 节点的渲染工作: 将 chip 挂载到 dom 视图上 (仅进行内存级别的 dom 操作)
 * @param chipRoot 
 * @param chip 
 */
export function completeRenderWorkForChipSync(chipRoot: ChipRoot, chip: Chip): void {
  switch (chip.chipType) {
    case ChipTypes.NATIVE_DOM:
      completeRenderWorkForElement(chip, chipRoot)
      break
    // 带虚拟容器的 chip 节点: component / virtual chip
    case ChipTypes.CUSTOM_COMPONENT:
      completeRenderWorkForComponent(chip, chipRoot)
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
 * 为 chip 挂载相匹配的 dom 节点
 * @param chip 
 */
export function mountElementForChip(chip: Chip): Element {
  let node: Chip = chip
  while (true) {
    if (node?.elm) {
      return node.elm
    }

    node = node.lastChild
  }
}

/**
 * 直接同步更新视图，同时缓存闲时任务，当满足条件时进入 idle 阶段执行相应的任务
 * @param chip 
 * @param chipRoot 
 * @param props 
 */
export function patchMutationSync(
  chip: Chip,
  chipRoot: ChipRoot,
  props: object
): void {
  // commit 视图变化
  commitProps(chip.elm, props)
  // 缓存闲时任务，将最新的属性状态补偿到对应的 chip 上
  cacheIdleJob(() => {
    chip.props = extend(chip.props, props)
  }, chipRoot)
}

/**
 * 为动态属性容器设置对应的属性字面量
 * @param literal 
 * @param propContainer 
 */
export function setLiteralForDynamicValue(literal: any, valueContainer: DynamicValueGetter): any {
  valueContainer.value = literal
  return literal
}

/**
 * 节点动态属性创建渲染副作用并收集依赖
 * @param chip 
 * @param chipRoot 
 * @param propName 
 * @param value 
 */
export function createRenderEffectForProp(
  chip: Chip,
  chipRoot: ChipRoot,
  propName: string,
  value: DynamicValueGetter
): StaticValue {
  let literal: StaticValue
  const e = effect<DynamicRenderData>(() => {
    // collector: 触发当前注册 effect 的收集行为
    // 执行动态属性取值器获取属性字面量
    literal = value()
    setLiteralForDynamicValue(literal, value)
    return { props: { [propName]: literal } }
  }, (newData: DynamicRenderData) => {
    // dispatcher: 响应式数据更新后触发
    // 使用最新的渲染数据直接同步刷新视图
    return patchMutationSync(chip, chipRoot, newData.props)
  }, {
    lazy: true,
    collectWhenLazy: true, // 首次仅做依赖收集但不执行派发逻辑
    scheduler: renderEffectScheduler,
    effectType: RenderEffectTypes.SYNC
  })

  // 将创建的 effect 存储至当前节点对应 chip context
  cacheEffectToChip(e, chip)
  return literal
}

/**
 * 条件节点动态数据创建对应的渲染副作用并收集依赖
 * @param chip 
 * @param chipRoot 
 * @param render 
 */
export function createRenderEffectForConditionChip(
  chip: Chip,
  chipRoot: ChipRoot,
  render: VirtualChipRender
): Effect {
  const e = effect<DynamicRenderData>(() => {
    const children: ChipChildren = render()
    chip.children = children
    return { children }
  }, (newData: DynamicRenderData) => {
    return handleChildJobOfRenderEffect(chip, chipRoot, newData)
  }, {
    lazy: true,
    collectWhenLazy: true,
    scheduler: renderEffectScheduler
  })

  cacheEffectToChip(e, chip)
  return e
}

/**
 * 创建可迭代 chip 节点对应的渲染副作用
 * @param chip 
 * @param chipRoot 
 * @param render 
 * @param source 
 * @param sourceKey 
 */
export function createRenderEffectForIterableChip(
  chip: Chip,
  chipRoot: ChipRoot,
  render: VirtualChipRender,
  sourceGetter: DynamicValueGetter
): void {
  const e = effect<DynamicRenderData>(() => {
    const children: Chip[] = []
    const sourceLiteral: object = sourceGetter()
    setLiteralForDynamicValue(sourceLiteral, sourceGetter)
    // 若根数据源本次渲染未发生变化，说明该 renderEffect 是由数据源的子代数据改变触发的
    chip.childMaySkip = (sourceLiteral === sourceGetter.value)
    for (const key in sourceLiteral) {
      const child: Chip = (render(sourceLiteral[key]) as Chip)
      children.push(child)
    }
    chip.children = children
    return { children }
  }, (newData: DynamicRenderData) => {
    return handleChildJobOfRenderEffect(chip, chipRoot, newData)
  }, {
    lazy: true,
    collectWhenLazy: true, // 首次仅做依赖收集但不执行派发逻辑
    scheduler: renderEffectScheduler,
    effectType: RenderEffectTypes.CONCURRENT
  })

  cacheEffectToChip(e, chip)
}

/**
 * 渲染副作用自带的调度器
 * 当渲染副作用被触发时，会优先执行该调度器对渲染副作用执行合适的调度注册
 * @param effect 
 */
export function renderEffectScheduler(effect: Effect): void {
  switch (renderMode) {
    case NukerRenderModes.TIME_SPLICING:
      // 渲染任务仅进行时间分片，无优先级
      registerJob(effect)
      break
    case NukerRenderModes.CONCURRENT:
      // concurrent 渲染模式下，根据当前事件优先级将 renderEffect 作为任务注册进调度系统，
      // 以保证渲染任务按照优先级策略调度执行
      registerJob(effect, currentEventPriority)
      break
    case NukerRenderModes.BATCH_SYNC:
    default:
      // TIME_SPLICING 渲染模式下，将当前 effect 推入渲染任务缓冲区
      pushRenderEffectToBuffer(effect)
      break
  }
}

/**
 * 处理渲染副作用的子任务
 * @param chip 
 * @param chipRoot 
 * @param newData 
 */
export function handleChildJobOfRenderEffect(
  chip: Chip,
  chipRoot: ChipRoot,
  newData: DynamicRenderData
): unknown {
  // 新旧 children 进行 reconcile
  const job: Function = genReconcileJob(
    chip,
    chipRoot,
    newData
  )
  switch (renderMode) {
    case NukerRenderModes.TIME_SPLICING:
    case NukerRenderModes.CONCURRENT:
      // TIME_SPLICING & CONCURRENT 渲染模式下 renderEffect 整体作为任务
      // 注册进调度系统，因此此处返回 renderEffect 对应的子任务，即实际的协调逻辑
      return job
    case NukerRenderModes.BATCH_SYNC:
    default:
      return performReconcileSync(chip, chipRoot)
  }
}

/**
 * 同步执行节点域的协调工作
 * @param chip 
 * @param chipRoot 
 */
export function performReconcileSync(chip: Chip, chipRoot: ChipRoot): void {
  const ancestorChip: Chip = chip
  let current: Chip = ancestorChip
  let last: Chip
  while (true) {
    if (current === ancestorChip) {
      if (current.phase === ChipPhases.PENDING) {
        const pointer: Chip = getPointerChip(chip.wormhole)
        cacheIdleJob(
          replaceChipContext.bind(null, chip, chip.wormhole, pointer),
          chipRoot
        )
        current = reconcile(last = current, pointer, chipRoot)
      } else {
        break
      }
    } else {
      current = reconcile(last = current, last, chipRoot)
    }
  }
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

/**
 * 将 effect 缓存至 chip 上下文中
 * @param effect 
 * @param chip 
 */
export function cacheEffectToChip(effect: Effect, chip: Chip): Effect {
  const effects = chip.effects
  const effectNode = {
    effect,
    next: null
  }
  if (effects) {
    effect.last = effects.last.next = effectNode
  } else {
    chip.effects = {
      first: effectNode,
      last: effectNode
    }
  }

  return effect
}

// 创建渲染信息描述 payload
export function createRenderPayloadNode(
  container: Element,
  parentContainer: Element,
  anchorContainer: Element | null,
  type: number,
  context: Chip,
  auxiliaryContext?: Chip,
  tag?: string,
  props?: Record<string | number | symbol, any>,
  callback?: Function
): RenderPayloadNode {
  return {
    [RenderFlags.IS_RENDER_PAYLOAD]: true,
    context,
    auxiliaryContext,
    type,
    tag,
    props,
    next: null,
    container,
    parentContainer,
    anchorContainer,
    callback
  }
}

/**
 * 需要进行 reconcile 进行 concurrent 渲染，生成 render payload，
 * 而不直接操作 dom 更新视图
 * @param chip 
 * @param chipRoot 
 * @param renderData 
 * @param needCommit
 */
export function genReconcileJob(
  chip: Chip,
  chipRoot: ChipRoot,
  renderData: DynamicRenderData
): Function {
  // renderData 是最新的渲染数据
  const { children } = renderData
  if (children) {
    // 存在动态子代节点，触发新旧子代节点的 diff 流程，并生产对应的 render payload
    const newChip = cloneChip(chip, EMPTY_OBJ, children)
    newChip.wormhole = chip
    // trigger reconcile diff
    const ancestorChip: Chip = newChip
    const reconcileJob = (chip: Chip, lastChip: Chip): Function => {
      // reconcile 持续进行到回溯至起始节点，返回 null 表示当前任务的全部子任务均已执行完毕
      if (chip === ancestorChip) {
        // 处理起始 chip 节点
        if (chip.phase === ChipPhases.PENDING) {
          if (renderMode === NukerRenderModes.CONCURRENT) {
            // 如果是 concurrent 渲染模式，任务可能被打断并中途插入新的任务，
            // 为保证任务重新开始后访问相对应的状态缓存，需要在 concurrent 任
            // 重新开始时卸载已失效的状态缓存，比如执行到半途但被其他任务插入，
            // 当该任务重新开始时由于要完全从头执行，因此将任务被打断前积累的
            // 失效状态缓存作为垃圾信息清理掉
            teardownChipCache(chipRoot)
          }

          const pointer: Chip = getPointerChip(chip.wormhole)
          cacheIdleJob(
            replaceChipContext.bind(null, chip, chip.wormhole, pointer),
            chipRoot
          )

          // 返回处理下一组 chip 节点的子任务
          const next: Chip = reconcile(chip, lastChip, chipRoot)
          return reconcileJob.bind(null, next, chip, chipRoot)
        } else {
          // reconcile 执行完毕，如需执行 commit 任务，则返回 commit
          // 子任务，否则当前任务返回 null 标记执行完毕
          return performCommitWork.bind(null, chipRoot)
        }
      } else {
        // 处理起始节点的子代节点
        const next: Chip = reconcile(chip, lastChip, chipRoot)
        return reconcileJob.bind(null, next, chip)
      }
    }

    return reconcileJob.bind(null, newChip)
  }
}

/**
 * 检测 chip 的 reconcile 是否可以跳过
 * @param chip
 */
export function isChipSkipable(chip: Chip): boolean {
  // chip reconcile 跳过的条件，满足其一即可:
  // 1. 节点本身为静态，且距离当前节点最近的 chip block 具有稳定的子代结构
  // 2. 可迭代数据生成的相似节点对 (key 相同代表对应数据源未发生变化)，且可迭代数据源本身无引用级变化
  return Boolean(
    chip.wormhole &&
    ((chip.compileFlags & CompileFlags.COMPLETE_STATIC) ||
    (chip.parent.childMaySkip && chip.key))
  )
}

/**
 * 检测 chip 节点本身是否可直接跳过
 * @param chip 
 */
export function isChipItselfSkipable(chip: Chip): boolean {
  return Boolean(
    chip.wormhole &&
    ((chip.compileFlags & CompileFlags.STATIC) ||
    chip.compileFlags & CompileFlags.RECONCILE_BLOCK)
  )
}

/**
 * 每个 chip 节点对的 diff 作为一个任务单元，且任务之间支持被调度系统打断、恢复
 * @param chip 
 * @param lastChip 
 * @param chipRoot 
 */
export function reconcile(chip: Chip, lastChip: Chip, chipRoot: ChipRoot): Chip {
  // 下一组要处理的 chip 节点对
  let nextChip: Chip
  switch (chip.phase) {
    case ChipPhases.PENDING:
      // 1. 首次遍历
      nextChip = initReconcile(chip, lastChip, chipRoot)
      break
    case ChipPhases.INITIALIZE:
      // 2. 回溯
      nextChip = completeReconcile(chip, lastChip, chipRoot)
      break
  }

  return nextChip
}

/**
 * 深度遍历阶段处理 chip 节点对
 * @param chip 
 * @param lastChip 
 * @param chipRoot 
 */
export function initReconcile(chip: Chip, lastChip: Chip, chipRoot: ChipRoot): Chip {
  chip.phase = ChipPhases.INITIALIZE

  // 首次遍历 chip 节点时判断该节点是否为可跳过 diff 的静态节点，
  // 如果可跳过，则不再对该 chip 做深度遍历，直接跳至下一个待处理 chip
  let nextChip: Chip
  if (isChipSkipable(chip)) {
    // chip 及其子代全部可跳过
    chip.skipable = true
    nextChip = completeReconcile(chip, lastChip, chipRoot)
  } else {
    if (isChipItselfSkipable(chip)) {
      // chip 节点本身可跳过 reconcile
      chip.selfSkipable = true
    } else {
      // chip 节点不可跳过 reconcile
      initReconcileForChip(chip, chipRoot)
    }

    // 获取下一个需要处理的 chip 节点
    const { children, wormhole } = chip
    const lastChild: Chip = getLastChipChild(children)
    if (lastChild) {
      chip.lastChild = lastChild
      lastChild.parent = chip
      chip.currentChildIndex = (isArray(children) ? (children.length - 1) : 0)
      // 建立新旧 chip 子节点之间的映射关系，便于 chip-tree 回溯阶段
      // 通过新旧节点间的映射关系进行节点对的 diff
      // 如果当前节点无对应的旧节点，那么子代节点不会做匹配，因此一旦某个
      // chip 节点不存在对应的旧节点，该 chip 对应的整个子树都不会有旧
      // 节点与之匹配
      const oldChildren: ChipChildren = wormhole?.children
      if (oldChildren && children) {
        matchChipChildren(oldChildren, children)
      }

      nextChip = lastChild
    } else {
      nextChip = completeReconcile(chip, lastChip, chipRoot)
    }
  }

  return nextChip
}

/**
 * 回溯阶段处理 chip 节点对
 * 完成 chip 节点对的 diff，生成渲染描述信息 (render payload)
 * @param chip 
 * @param auxiliaryChip 
 * @param chipRoot 
 * @param isSkipable 
 */
export function completeReconcile(
  chip: Chip,
  auxiliaryChip: Chip,
  chipRoot: ChipRoot
): Chip {
  chip.phase = ChipPhases.COMPLETE

  // 如果 chip 节点不跳过，则 diff 出更新描述 render payload
  if (!chip.selfSkipable) {
    // 优先处理子节点事务，根据收集的待删除子节点生成对应的 render payload
    if (hasDeletions(chip)) {
      genRenderPayloadsForDeletions(chip.deletions, chipRoot)
    }
    // 生成当前节点 diff 的 render payload 并入队
    reconcileToGenRenderPayload(chip, auxiliaryChip, chipRoot)
    // 入队深度遍历阶段缓存在当前节点上的 render payload，如该节点的 dom 移动操作
    cacheRenderPayload(chip.renderPayloads.first, chipRoot)

    completeReconcileForChip(chip, chipRoot)
  }

  // 获取下一组需要处理的 chip 节点对
  let sibling: Chip = chip.prevSibling
  if (sibling === null) {
    // 尝试创建有效 sibling 节点
    const parent: Chip = chip.parent
    const children: ChipChildren = parent?.children
    if (isArray(children)) {
      sibling = children[--parent.currentChildIndex]
    }
  }

  let next: Chip
  if (sibling) {
    // 如果存在同级兄弟节点，则兄弟节点作为下一个要处理的 chip 节点
    chip.prevSibling = sibling
    sibling.parent = chip.parent
    next = sibling
  } else {
    // 无同级兄弟节点，表明与当前节点同级的节点全部处理完毕，则开始
    // 回溯，以当前节点的父节点作为下一个待处理的 chip 节点
    next = chip.parent
  }

  return next
}

/**
 * 协调过程中首次访问 chip 节点
 * 1. 完成自身的渲染初始化工作
 * 2. 建立新旧子代节点的映射关系，确定好子代节点的删除、移动
 * 3. 卸载旧的 chip 节点对应的 effects，因为重新执行 render
 *    函数会对新节点中的动态数据重新进行依赖收集
 * @param chip 
 * @param chipRoot 
 */
export function initReconcileForChip(chip: Chip, chipRoot: ChipRoot): Chip {
  const { chipType, wormhole } = chip
  switch (chipType) {
    case ChipTypes.NATIVE_DOM:
      initReconcileForElement(chip, chipRoot)
      break
    case ChipTypes.CONDITION:
      // 条件节点
      initConditionChip(chip, chipRoot)
      break
    case ChipTypes.FRAGMENT:
      // 可迭代节点
      initIterableChip(chip, chipRoot)
      break
    case ChipTypes.CUSTOM_COMPONENT:
      // 组件类型节点
      initReconcileForComponent(chip, chipRoot)
      break
  }

  // 卸载当前 chip 对应的旧 chip (相似节点) 上的 effects，当前
  // chip 初始化时会重新对新的动态数据进行渲染副作用收集
  if (wormhole) {
    cacheIdleJob(teardownAbandonedEffects.bind(null, wormhole), chipRoot)
  }

  return chip
}

/**
 * 初始化条件 chip 节点
 * @param chip 
 * @param chipRoot 
 */
export function initConditionChip(chip: Chip, chipRoot: ChipRoot): Chip {
  const { render } = (chip.instance as VirtualInstance) = createVirtualChipInstance(chip)
  createRenderEffectForConditionChip(chip, chipRoot, render)
  return chip
}

/**
 * 初始化可迭代 chip 节点
 * @param chip 
 * @param chipRoot 
 */
export function initIterableChip(chip: Chip, chipRoot: ChipRoot): Chip {
  const {
    sourceGetter, // 数据源 getter，数据源本身可能为根级响应式数据，也可能为其他响应式数据源的子级数据
    render // 模板渲染器
  } = (chip.instance as VirtualInstance) = createVirtualChipInstance(chip)
  createRenderEffectForIterableChip(chip, chipRoot, render, sourceGetter)

  return chip
}

/**
 * 初始化原生 dom 节点的协调工作
 * @param chip 
 * @param chipRoot 
 */
export function initReconcileForElement(chip: Chip, chipRoot: ChipRoot): void {
  if (!chip.wormhole) {
    // 生成对应的 dom 容器创建 render payload
    const payload = createRenderPayloadNode(
      null,
      null,
      null,
      RenderUpdateTypes.CREATE_ELEMENT,
      chip,
      null,
      (chip.tag as string),
      null,
      (context: Chip, elm: Element) => {
        // 当前 render payload commit 之后，将创建的 dom 容器
        // 挂载到 chip 上下文上，便于子节点挂载时能够访问到对应的父 dom 容器
        context.elm = elm
      }
    )
    cacheRenderPayload(payload, chipRoot)
  }
}

/**
 * 初始化自定义组件的协调工作
 * @param chip 
 * @param chipRoot 
 */
export function initReconcileForComponent(chip: Chip, chipRoot: ChipRoot): void {
  const { source, render } = chip.instance = createComponentInstance((chip.tag as Component), chip)
  disableCollecting()
  chip.children = render(source)
  enableCollecting()

  if (!chip.wormhole) {
    // 无对应旧 chip 节点，表示当前 chip 为待挂载节点
    // 触发 init 生命周期
    invokeLifecycle(LifecycleHooks.INIT, chip.instance)
    // 触发 willMount 生命周期
    invokeLifecycle(LifecycleHooks.WILL_MOUNT, chip.instance)
  } else {
    // 组件节点存在配对的相似节点，说明组件会做更新，因此触发 willMount 生命周期
    invokeLifecycle(LifecycleHooks.WILL_UPDATE, chip.instance)
  }
}

/**
 * 根据 chip 类型完成对应的回溯阶段协调工作
 * @param chip 
 * @param chipRoot 
 */
export function completeReconcileForChip(chip: Chip, chipRoot: ChipRoot): void {
  switch (chip.chipType) {
    case ChipTypes.CUSTOM_COMPONENT:
      completeReconcileForComponent(chip, chipRoot)
      break
    default:
      break
  }
}

/**
 * 完成自定义组件对应的回溯阶段协调工作
 * @param chip 
 * @param chipRoot 
 */
export function completeReconcileForComponent(chip: Chip, chipRoot: ChipRoot): void {
  // 缓存视图改变的生命周期 (mounted | updated)，reconcile 阶段仅是数据层面的处理，
  // 未发生实际的视图渲染，因此需要将生命周期缓存至队列，commit 阶段后再批量执行
  const inst = (chip.instance as ComponentInstance)
  if (chip.wormhole) {
    // 组件类型节点存在旧的相似节点，走更新逻辑，缓存组件的 updated 
    // 生命周期到全局生命周期缓存队列
    registerLifecycleHook(
      chipRoot,
      LifecycleHooks.UPDATED,
      inst[LifecycleHooks.UPDATED]?.first
    )
  } else {
    // 组件类型节点无对应的相似节点，走挂载逻辑，缓存组件的 mounted
    // 生命周期到全局生命周期缓存队列
    registerLifecycleHook(
      chipRoot,
      LifecycleHooks.MOUNTED,
      inst[LifecycleHooks.MOUNTED]?.first
    )
  }
}

/**
 * 建立 chip 子节点之间的映射关系，并生成部分子代节点对应的 render payload
 * 主要涉及子节点的删除、移动
 * @param oldChildren 
 * @param newChildren 
 */
export function matchChipChildren(oldChildren: ChipChildren, newChildren: ChipChildren): void {
  // todo 待删除子节点 render payload 创建、收容；
  // 子节点移动创建 render payload，并将其挂载到需要移动的 chip 上，等该
  // chip 进入回溯阶段再进行 render payload 的派发
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

/**
 * 新旧 chip (仅 chip 节点本身) diff 生成更新描述
 * 配对方式有以下几种:
 * · 类型、key 均相同的相似节点 (属性更新)
 * · 旧节点为 null，新节点为有效节点 (挂载新节点)
 * @param chip 
 * @param auxiliaryChip 
 * @param chipRoot 
 */
export function reconcileToGenRenderPayload(
  chip: Chip,
  auxiliaryChip: Chip,
  chipRoot: ChipRoot
): RenderPayloadNode | RenderPayloadNode[] {
  const { tag, props, wormhole } = chip
  let payload: RenderPayloadNode | RenderPayloadNode[]
  const onPropPatched = (elm: Element, ) => {

  }
  if (wormhole) {
    // 有匹配的旧节点，且新旧 chip 节点一定是相似节点
    const propsToPatch: object = reconcileProps(chip, wormhole, chipRoot)
    payload = createRenderPayloadNode(
      wormhole.elm, // 此时新 chip 还未 commit 到 dom，因此获取不到实际的 element 元素
      null,
      null,
      RenderUpdateTypes.PATCH_PROP,
      chip,
      null,
      (tag as string),
      propsToPatch,
      onPropPatched
    )
    cacheRenderPayload(payload, chipRoot)
  } else {
    // 无匹配到的旧 chip 节点，新 chip 为待挂载节点。由于 dive 阶段
    // 已创建生成 dom 容器的 render payload，因此 bubble 阶段需要
    // 完成节点属性的 patch 、节点的挂载，这样才能完整将新的节点挂载
    // 到 dom 上
    const patchPropsPayload = createRenderPayloadNode(
      null,
      null,
      null,
      RenderUpdateTypes.PATCH_PROP,
      chip,
      null,
      (tag as string),
      props,
      onPropPatched
    )
    const mountPayload = createRenderPayloadNode(
      null,
      null,
      null,
      RenderUpdateTypes.MOUNT,
      chip,
      auxiliaryChip
    )
    payload = [patchPropsPayload, mountPayload]
    cacheRenderPayload(payload, chipRoot)
  }
  
  return payload
}

// 根据缓存的待删除子节点生成对应的 render payload
export function genRenderPayloadsForDeletions(deletions: Chip[], chipRoot: ChipRoot): void {
  for (let i = 0; i < deletions.length; i++) {
    const deletion = deletions[i]
    const elm = deletion.elm
    const payload = createRenderPayloadNode(
      elm,
      domOptions.parentNode(elm),
      null,
      RenderUpdateTypes.UNMOUNT,
      deletion
    )
    cacheRenderPayload(payload, chipRoot)
    cacheIdleJob(teardownDeletion.bind(null, deletion), chipRoot)
  }
}

/**
 * 两组 props diff 生成变化 prop 的集合
 * @param newProps 
 * @param oldProps 
 */
export function reconcileProps(
  newChip: Chip,
  oldChip: Chip,
  chipRoot: ChipRoot
): Record<string, any> {
  const newProps: ChipProps = newChip.props
  const oldProps: ChipProps = oldChip.props
  const ret = createEmptyObject()
  // 遍历新 props，找出需要 patch 的 prop
  for (const propName in newProps) {
    let value = newProps[propName]
    if (isFunction(value)) {
      // 为新属性中的动态数据创建渲染副作用，并执行依赖收集
      value = createRenderEffectForProp(
        newChip.wormhole,
        chipRoot,
        propName,
        value
      )
    }

    if (propName in oldProps) {
      let oldValue = oldProps[propName]
      // 获取旧属性值的字面量
      oldValue = getPropLiteralValue(oldValue)
      if (value !== oldValue) {
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

/**
 * 缓存 render payload
 * @param payload 
 * @param chipRoot 
 */
export function cacheRenderPayload(
  payload: RenderPayloadNode | RenderPayloadNode[],
  chip: ChipRoot | Chip
): RenderPayloadNode | RenderPayloadNode[] {
  if (isArray(payload)) {
    for (let i = 0; i < payload.length; i++) {
      cacheRenderPayload(payload[i], chip)
    }
  } else {
    const payloads = chip.renderPayloads
    if (payloads) {
      payloads.last = payloads.last.next = payload
    } else {
      chip.renderPayloads = {
        first: payload,
        last: payload
      }
    }
  }

  return payload
}
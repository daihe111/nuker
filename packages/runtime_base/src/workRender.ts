import {
  Chip,
  ChipChildren,
  ChipProps,
  getLastChipChild,
  DynamicValueGetter,
  StaticValue,
  getPropLiteralValue,
  createChip,
  isSameChip,
  ChipKey,
  IdleJobUnit,
  isLastChildOfChip,
  ChipTypeFlags
} from "./chip";
import { isArray, isFunction, createEmptyObject, extend, isString, isNumber, EMPTY_OBJ, deleteProperty, hasOwn, NOOP, createListAccessor } from "../../share/src";
import {
  registerJob
} from "./scheduler";
import { ComponentInstance, Component, createComponentInstance, mountComponentChildren, getComponentChildren } from "./component";
import { domOptions } from "./domOptions";
import { effect, disableCollecting, enableCollecting, Effect } from "../../reactivity/src/effect";
import { performCommitWork, commitProps, PROP_TO_DELETE } from "./commit";
import { createVirtualChipInstance, VirtualInstance, VirtualChipRender } from "./virtualChip";
import { CompileFlags } from "./compileFlags";
import { pushRenderEffectToBuffer, RenderEffectTypes, initRenderEffectBuffer } from "./renderEffectBuffer";
import {
  cacheIdleJob,
  performIdleWork,
  teardownAbandonedEffects,
  teardownDeletions,
  updateChipContext
} from "./idle";
import { invokeLifecycle, LifecycleHooks, registerLifecycleHook } from "./lifecycle";
import { currentEventPriority } from "../../runtime_dom/src/event";
import { ListAccessor } from "../../share/src/shareTypes";

export type AppContent = | Component

export interface ReconcileChipPair {
  oldChip: Chip | null
  newChip: Chip | null
}

export interface RenderMaterial {
  props?: Record<string | number | symbol, any>
  children?: ChipChildren
}

export const enum RenderFlags {
  IS_RENDER_PAYLOAD = '__n_isRenderPayload'
}

// chip 遍历指针
export interface ChipTraversePointer {
  next: Chip // 下一个要遍历的 chip
  phase: boolean // 遍历下一 chip 时对应的遍历阶段
}

export interface NukerRenderOptions {
  renderMode: number
}

export interface RenderPayloadNode {
  // data
  action: number
  container?: Element | DocumentFragment
  parentContainer?: Element | DocumentFragment
  tag?: string
  props?: Record<string | number | symbol, any>

  // contexts
  context: Chip // 当前 render payload 所属 chip 上下文
  parentContext?: Chip
  anchorContext?: Chip

  // hooks
  callback?: Function // render payload commit 之后要执行的回调

  // pointers
  next: RenderPayloadNode | null
}

export const enum RenderActions {
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

export const renderInstrumentations = {
  // 原生 dom 节点
  [ChipTypeFlags.ELEMENT]: {
    onInitRender: initRenderWorkForElement,
    onCompleteRender: completeRenderWorkForElement,
    onInitReconcile: initReconcileForElement,
    onCompleteReconcile: NOOP
  },
  // 自定义组件
  [ChipTypeFlags.COMPONENT]: {
    onInitRender: initRenderWorkForComponent,
    onCompleteRender: completeRenderWorkForComponent,
    onInitReconcile: initReconcileForComponent,
    onCompleteReconcile: completeReconcileForComponent
  },
  // 函数式组件
  [ChipTypeFlags.FUNCTIONAL_COMPONENT]: {
    onInitRender: initRenderWorkForComponent,
    onCompleteRender: completeRenderWorkForComponent,
    onInitReconcile: initReconcileForComponent,
    onCompleteReconcile: completeReconcileForComponent
  },
  // 类组件
  [ChipTypeFlags.CLASS_COMPONENT]: {
    onInitRender: initRenderWorkForComponent,
    onCompleteRender: completeRenderWorkForComponent,
    onInitReconcile: initReconcileForComponent,
    onCompleteReconcile: completeReconcileForComponent
  },
  // option 组件
  [ChipTypeFlags.OPTION_COMPONENT]: {
    onInitRender: initRenderWorkForComponent,
    onCompleteRender: completeRenderWorkForComponent,
    onInitReconcile: initReconcileForComponent,
    onCompleteReconcile: completeReconcileForComponent
  },
  // 条件虚拟容器节点
  [ChipTypeFlags.CONDITION]: {
    onInitRender: initRenderWorkForConditionChip,
    onCompleteRender: completeRenderWorkForConditionChip,
    onInitReconcile: initReconcileForConditionChip,
    onCompleteReconcile: NOOP
  },
  // 可迭代虚拟容器节点
  [ChipTypeFlags.ITERATOR]: {
    onInitRender: initRenderWorkForIteratorChip,
    onCompleteRender: completeRenderWorkForIteratorChip,
    onInitReconcile: initReconcileForIteratorChip,
    onCompleteReconcile: NOOP
  }
}

export let currentRenderingInstance: ComponentInstance | VirtualInstance = null // 当前正在执行渲染工作的组件 instance
export let renderMode: number = NukerRenderModes.TIME_SPLICING // 框架的渲染模式

/**
 * nuker 框架渲染总入口方法
 * @param appContent 
 * @param props 
 * @param container 
 * @param options 
 */
export function render(
  appContent: AppContent,
  props: ChipProps,
  container: Element | string,
  options?: NukerRenderOptions
): Element {
  const chip: Chip = createChip(
    appContent,
    props,
    null,
    ChipTypeFlags.COMPONENT
  )
  // 为根组件节点挂载一个虚拟 fragment 容器，便于离屏渲染时多根节点的挂载
  const domRoot: DocumentFragment = chip.elm = domOptions.createFragment()

  // 执行离屏渲染，渲染完成后将内存中的根节点挂载到指定的 dom 容器中
  performRender(chip)
  container = isString(container) ? domOptions.getElementById(container) : container
  if (container) {
    domOptions.appendChild(domRoot, container)
  }

  // 首次挂载视图结束，执行框架初始化逻辑
  // 框架默认渲染模式为 BATCH_SYNC
  let renderMode: number = NukerRenderModes.BATCH_SYNC
  if (options && isNumber(options.renderMode)) {
    renderMode = options.renderMode
  }

  if (renderMode === NukerRenderModes.BATCH_SYNC) {
    initRenderEffectBuffer({
      onFlushed: () => {
        // 一次事件循环中声明一组 renderPayloads、idleJobs，即用即销，多次任务不耦合状态
        const renderPayloads: ListAccessor<RenderPayloadNode> = createListAccessor()
        const idleJobs: ListAccessor<IdleJobUnit> = createListAccessor()
        performCommitWork(renderPayloads.first)
        performIdleWork(idleJobs.first)
      }
    })
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
 * @param chip 
 */
export function performRender(chip: Chip): void {
  let pointer: ChipTraversePointer = {
    next: chip,
    phase: false
  }
  while (pointer) {
    pointer = performChipWork(pointer.next, pointer.phase)
  }
}

/**
 * 处理当前遍历 chip 节点
 * callback 会回传当前 chip 节点挂载后的 dom 容器
 * @param chip 
 * @param phase
 * @param callback 
 */
export function performChipWork(
  chip: Chip,
  phase: boolean = false,
  callback?: (chip: Chip) => void
): ChipTraversePointer {
  if (phase) {
    // 回溯遍历阶段
    return completeRenderWork(chip, callback)
  } else {
    // 深度遍历阶段
    return initRenderWork(chip, callback)
  }
}

/**
 * 为当前 chip 执行可供渲染用的相关准备工作
 * @param chip 
 * @param onCompleted 
 */
export function initRenderWork(
  chip: Chip,
  onCompleted: (chip: Chip) => void
): ChipTraversePointer {
  // 当前节点需要做的预处理工作
  renderInstrumentations[chip.chipType].onInitRender(chip)

  const children: ChipChildren = chip.children
  if (children) {
    // 存在更深层级的子节点需优先处理，
    const firstChild: Chip = children[0]
    if (firstChild) {
      // 创建父子关系
      firstChild.parent = chip
      // 记录下一节点在子节点序列中的索引位置
      firstChild.position = 0
      return {
        next: firstChild,
        phase: false
      }
    }
  } else {
    // 无更深层级的子节点，处理当前节点的渲染工作
    return completeRenderWork(chip, onCompleted)
  }
}

/**
 * chip 是叶子节点或者回溯阶段的节点，完成该节点的全部渲染工作
 * 返回下一个要处理的 chip 节点
 * 同级兄弟节点的处理顺序为从头到尾，因为首次挂载不需要锚点，appendChild 只需要父节点
 * @param chip 
 * @param callback 
 */
export function completeRenderWork(
  chip: Chip,
  callback?: (chip: Chip) => void
): ChipTraversePointer {
  // 对应类型节点完成渲染工作
  renderInstrumentations[chip.chipType].onCompleteRender(chip)

  if (isFunction(callback)) {
    callback(chip)
  }

  // 计算下一个需要处理的节点
  const parent: Chip = chip.parent
  if (isLastChildOfChip(chip, parent)) {
    // 同级子节点已全部处理完毕，准备向父级回溯
    return parent ? {
      next: parent,
      phase: true
    } : null
  } else {
    // 存在同级兄弟节点，继续深度遍历此兄弟节点
    const nextPosition: number = chip.position + 1
    const nextChip: Chip = parent.children[nextPosition]
    nextChip.position = nextPosition
    nextChip.parent = parent
    return {
      next: nextChip,
      phase: false
    }
  }
}

/**
 * 初始化 component 类型节点的渲染工作
 * @param chip 
 */
export function initRenderWorkForComponent(chip: Chip): void {
  // 继承实体 dom 元素
  const parent: Chip = chip.parent
  chip.elm = parent?.elm

  const instance: ComponentInstance = chip.instance = createComponentInstance((chip.tag as Component), chip)
  // 执行组件的 init 生命周期，此时只能访问到组件实例
  invokeLifecycle(LifecycleHooks.INIT, instance)
  // 此处仅通过 render 渲染器获取组件节点的子节点，不做响应式系统的依赖收集
  disableCollecting()
  // 为组件节点挂载子节点
  mountComponentChildren(chip)
  // 恢复响应式系统的依赖收集
  enableCollecting()
  // 触发 willMount 生命周期，此刻为执行组件渲染挂载工作前的最后时机
  invokeLifecycle(LifecycleHooks.WILL_MOUNT, instance)
}

/**
 * 初始化 nuker 内置 component 类型节点的渲染工作
 * @param chip 
 */
export function initRenderWorkForReservedComponent(chip: Chip): void {
  // 继承实体 dom 元素
  const parent: Chip = chip.parent
  chip.elm = parent?.elm

  mountComponentChildren(chip)
}

/**
 * 初始化 element 类型节点的渲染工作: dom 容器创建
 * @param chip 
 */
export function initRenderWorkForElement(chip: Chip): void {
  const { tag, isSVG, is } = chip
  chip.elm = domOptions.createElement((tag as string), isSVG, is)
}

/**
 * 初始化条件类型节点的渲染工作
 * if-chip: 数据变化时触发整个 render 重新执行
 * (source, sourceKey) => {
 *   return source[sourceKey[0]] === 1 ? <A /> : (source[sourceKey[1]] === 2 ? <B /> : <C />)
 * }
 * @param chip 
 */
export function initRenderWorkForConditionChip(chip: Chip): void {
  // 继承实体 dom 元素
  const parent: Chip = chip.parent
  chip.elm = parent?.elm
  const { render } = (chip.instance as VirtualInstance) = createVirtualChipInstance(chip)
  createRenderEffectForConditionChip(chip, render)
}

/**
 * 初始化可遍历类型节点的渲染工作
 * for-chip: 每个单元节点均对应一个单元渲染器 render，并且是深度收集
 * case 1: iterable source 直接全量被替换，重新执行 render 生成新的
 *   全新节点片段，并与旧的节点片段做 reconcile
 * case 2: iterable source 本身引用不变，对一级子元素做改变，只需要对
 *   一级元素改变的 key 对应的子 render 进行新节点生成，并对新旧节点对
 *   进行 reconcile
 * case 3: iterable source 本身引用不变，对一级以下元素做改变，此情况
 *   下发生值变化的数据所对应的 dom 结构一定是稳定的，无需特殊处理
 * for-chip 编译出的渲染器
 * @param chip 
 */
export function initRenderWorkForIteratorChip(chip: Chip): void {
  // 继承实体 dom 元素
  const parent: Chip = chip.parent
  chip.elm = parent?.elm
  const {
    sourceGetter, // 数据源 getter，数据源本身可能为根级响应式数据，也可能为其他响应式数据源的子级数据
    render // 模板渲染器
  } = (chip.instance as VirtualInstance) = createVirtualChipInstance(chip)
  createRenderEffectForIteratorChip(chip, render, sourceGetter)
}

/**
 * 完成 element 类型节点的渲染工作: 当前节点插入父 dom 容器
 * @param chip 
 */
export function completeRenderWorkForElement(chip: Chip): void {
  // 将当前 chip 对应的实体 dom 元素插入父 dom 容器
  const parentElm: Element | DocumentFragment = chip.parent?.elm
  const elm = chip.elm
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
      createRenderEffectForProp(chip, propName, value)
    }

    // 将属性插入对应的 dom 节点
    if (elm) {
      domOptions.setAttribute(elm, propName, `${value}`)
    }
  }
}

export function completeRenderWorkForIteratorChip(chip: Chip): void {
  mountAnchorForChip(chip)
}

export function completeRenderWorkForConditionChip(chip: Chip): void {
  mountAnchorForChip(chip)
}

/**
 * 完成 component 类型节点的渲染工作: 当前节点插入父 dom 容器
 * @param chip 
 */
export function completeRenderWorkForComponent(chip: Chip): void {
  mountAnchorForChip(chip)
}

/**
 * 为虚拟容器类型的 chip 挂载定位锚点
 * @param chip 
 */
export function mountAnchorForChip(chip: Chip): void {
  chip.anchor = domOptions.createElement('div')
  domOptions.appendChild(chip.anchor, chip.parent.elm)
}

/**
 * 直接同步更新视图，同时缓存闲时任务，当满足条件时进入 idle 阶段执行相应的任务
 * @param chip 
 * @param props 
 */
export function patchMutationSync(
  chip: Chip,
  props: object
): void {
  // commit 视图变化
  commitProps(chip.elm, props)
  // 将更新后的属性值补偿到对应的 chip 上下文
  extend(chip.props, props)
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
 * @param propName 
 * @param value 
 */
export function createRenderEffectForProp(
  chip: Chip,
  propName: string,
  value: DynamicValueGetter
): StaticValue {
  let literal: StaticValue
  const e = effect<RenderMaterial>(() => {
    // collector: 触发当前注册 effect 的收集行为
    // 执行动态属性取值器获取属性字面量
    literal = value()
    setLiteralForDynamicValue(literal, value)
    return { props: { [propName]: literal } }
  }, (material: RenderMaterial) => {
    // dispatcher: 响应式数据更新后触发
    // 使用最新的渲染数据直接同步刷新视图
    return patchMutationSync(chip, material.props)
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
 * @param render 
 */
export function createRenderEffectForConditionChip(
  chip: Chip,
  render: VirtualChipRender
): Effect {
  const e = effect<RenderMaterial>(() => {
    const children: ChipChildren = (render() as ChipChildren)
    chip.children = children
    return { children }
  }, (material: RenderMaterial) => {
    return handleChildJobOfRenderEffect(chip, material)
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
 * @param render 
 * @param source 
 * @param sourceKey 
 */
export function createRenderEffectForIteratorChip(
  chip: Chip,
  render: VirtualChipRender,
  sourceGetter: DynamicValueGetter
): void {
  const e = effect<RenderMaterial>(() => {
    const children: Chip[] = []
    const sourceLiteral: object = sourceGetter()
    setLiteralForDynamicValue(sourceLiteral, sourceGetter)
    for (const key in sourceLiteral) {
      const source = sourceLiteral[key]
      const child: Chip = (render(source) as Chip)
      // 建立节点与生成该节点数据源间的映射关系
      child.source = source
      children.push(child)
    }
    chip.children = children
    return { children }
  }, (material: RenderMaterial) => {
    return handleChildJobOfRenderEffect(chip, material)
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
 * @param material 
 */
export function handleChildJobOfRenderEffect(
  chip: Chip,
  material: RenderMaterial
): Function | void {
  // 新旧 children 进行 reconcile
  const job: Function = genReconcileJob(
    chip,
    material
  )
  switch (renderMode) {
    case NukerRenderModes.TIME_SPLICING:
    case NukerRenderModes.CONCURRENT:
      // TIME_SPLICING & CONCURRENT 渲染模式下 renderEffect 整体作为任务
      // 注册进调度系统，因此此处返回 renderEffect 对应的子任务，即实际的协调逻辑
      return job
    case NukerRenderModes.BATCH_SYNC:
    default:
      return performReconcileSync(chip, material)
  }
}

/**
 * 同步执行节点域的协调工作
 * @param chip 
 * @param renderData
 */
export function performReconcileSync(
  chip: Chip,
  { children }: RenderMaterial
): void {
  const ancestor: Chip = chip
  const renderPayloads: ListAccessor<RenderPayloadNode> = createListAccessor()
  const idleJobs: ListAccessor<IdleJobUnit> = createListAccessor()

  // 缓存闲时任务
  cacheIdleJob(() => {
    // commit 阶段渲染 dom 会对 nuker 的 chip 产生数据层面的副作用，
    // 导致 dom 节点与 chip 数据不同步，因此 commit 后需将最新 dom
    // 数据补偿到对应 chip
    updateChipContext(chip, null, children)
  }, idleJobs)

  if (chip.children && children) {
    // 建立新旧子节点序列之间的关联
    connectChipChildren(chip.children, children, chip)
  }

  if (children?.length) {
    let currentPointer: ChipTraversePointer = {
      next: children[children.length - 1],
      phase: false
    }
    while (true) {
      const { next, phase } = currentPointer
      if (next === ancestor && phase) {
        // 回溯到祖先节点，局部 chip 的 reconcile 全部完成
        break
      }
  
      currentPointer = reconcile(
        next,
        phase,
        renderPayloads,
        idleJobs
      )
    }

    performCommitWork(renderPayloads.first)
    performIdleWork(idleJobs.first)
  } else {
    // 无新的子代节点，生成待删除节点的 render payload，并批量提交到 dom
    genRenderPayloadsForDeletions(chip.children, renderPayloads, idleJobs)
    performCommitWork(renderPayloads.first)
    performIdleWork(idleJobs.first)
  }
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

/**
 * 创建 dom 渲染描述
 * @param container 
 * @param parentContainer 
 * @param anchorContainer 
 * @param type 
 * @param context 
 * @param tag 
 * @param props 
 * @param callback 
 */
export function createRenderPayloadNode(
  action: number,
  tag: string,
  props?: Record<string | number | symbol, any>,
  container?: Element | DocumentFragment,
  parentContainer?: Element | DocumentFragment,
  context?: Chip,
  parentContext?: Chip,
  anchorContext?: Chip,
  callback?: Function
): RenderPayloadNode {
  return {
    context,
    action,
    tag,
    props,
    next: null,
    container,
    parentContainer,
    parentContext,
    anchorContext,
    callback
  }
}

/**
 * 创建 reconcile 任务，将新旧 chip 树的 reconcile 按节点维度拆分为嵌套
 * 的子任务，每一对节点的 reconcile 都会作为一个子任务
 * @param chip 
 * @param renderData 
 */
export function genReconcileJob(
  chip: Chip,
  { children }: RenderMaterial
): Function {
  // 声明 reconcile 任务自身的缓存信息，此缓存信息会被子任务闭包使用，因此在当前
  // reconcile 任务被打断作废后，须及时释放对应的闭包的引用。
  // 任务作废后调度系统会放弃对该任务所产生子任务闭包的引用，转而引用原始的 reconcile
  // 任务，因此一旦任务作废，闭包内部变量一定会被释放
  const renderPayloads: ListAccessor<RenderPayloadNode> = createListAccessor()
  const idleJobs: ListAccessor<IdleJobUnit> = createListAccessor()

  // 缓存闲时任务
  cacheIdleJob(() => {
    // commit 阶段渲染 dom 会对 nuker 的 chip 产生数据层面的副作用，
    // 导致 dom 节点与 chip 数据不同步，因此 commit 后需将最新 dom
    // 数据补偿到对应 chip
    updateChipContext(chip, null, children)
  }, idleJobs)

  if (chip.children && children) {
    // 创建新旧子序列之间的关联关系
    connectChipChildren(chip.children, children, chip)
  }

  const ancestor: Chip = chip
  let reconcileJob = (
    chip: Chip,
    phase: boolean,
    renderPayloads: ListAccessor<RenderPayloadNode>,
    idleJobs: ListAccessor<IdleJobUnit>
  ): Function => {
    if (chip === ancestor && phase) {
      // 回溯到祖先节点，全部子节点均已完成 reconcile
      performCommitWork(renderPayloads.first)
      // 批量执行 reconcile、commit 阶段缓存的闲时任务
      performIdleWork(idleJobs.first)
      // 结束当前 reconcile 任务，并将闭包释放
      return null
    }

    const nextPointer: ChipTraversePointer = reconcile(
      chip,
      phase,
      renderPayloads,
      idleJobs
    )
    // 生成子任务
    return () => {
      return reconcileJob(
        nextPointer.next,
        nextPointer.phase,
        renderPayloads,
        idleJobs
      )
    }
  }

  if (children?.length) {
    // 存在新的子节点，从最后一个子节点开始 reconcile
    return () => {
      return reconcileJob(
        children[children.length - 1],
        false,
        renderPayloads,
        idleJobs
      )
    }
  }

  // 无新的子节点，需将全部旧的子节点卸载
  return () => {
    // 根据要删除的节点生成对应的渲染描述
    genRenderPayloadsForDeletions(chip.children, renderPayloads, idleJobs)
    // 批量将渲染描述提交到 dom 视图，并同步执行闲时任务
    performCommitWork(renderPayloads.first)
    // 批量执行 reconcile、commit 阶段缓存的闲时任务
    performIdleWork(idleJobs.first)
    // 本次 reconcile 任务全部执行完毕，返回空子任务表示本任务结束
    // 同时释放调度系统对闭包的引用，释放闭包变量
    return null
  }
}

/**
 * 检测 chip 的 reconcile 是否可以跳过
 * @param chip
 */
export function isChipSkipable(chip: Chip): boolean {
  // chip reconcile 跳过的条件，满足其一即可:
  // 1. 节点本身为静态，且距离当前节点最近的 chip block 具有稳定的子代结构
  // 2. 可迭代数据生成的相似节点对原始数据源相同，渲染器相同的情况下所生成的节点一定是完全一致的，无需 diff
  return Boolean(
    chip.wormhole &&
    ((chip.compileFlags & CompileFlags.COMPLETE_STATIC) ||
    chip.source === chip.wormhole.source)
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
 * @param phase 
 * @param renderPayloads 
 * @param idleJobs 
 */
export function reconcile(
  chip: Chip,
  phase: boolean,
  renderPayloads: ListAccessor<RenderPayloadNode>,
  idleJobs: ListAccessor<IdleJobUnit>
): ChipTraversePointer {
  if (phase) {
    return completeReconcile(chip, renderPayloads, idleJobs)
  } else {
    return initReconcile(chip, renderPayloads, idleJobs)
  }
}

/**
 * 深度遍历阶段处理 chip 节点对
 * @param chip 
 * @param renderPayloads 
 * @param idleJobs 
 */
export function initReconcile(
  chip: Chip,
  renderPayloads: ListAccessor<RenderPayloadNode>,
  idleJobs: ListAccessor<IdleJobUnit>
): ChipTraversePointer {
  // 首次遍历 chip 节点时判断该节点是否为可跳过 diff 的静态节点，
  // 如果可跳过，则不再对该 chip 做深度遍历，直接跳至下一个待处理 chip
  if (isChipSkipable(chip)) {
    // chip 及其子代全部可跳过
    chip.skipable = true
    return completeReconcile(chip, renderPayloads, idleJobs)
  } else {
    if (isChipItselfSkipable(chip)) {
      // chip 节点本身可跳过 reconcile
      chip.selfSkipable = true
    } else {
      // chip 节点不可跳过 reconcile
      renderInstrumentations[chip.chipType].onInitReconcile(
        chip,
        renderPayloads
      )

      // 卸载当前 chip 对应的旧 chip (相似节点) 上的 effects，当前
      // chip 初始化时会重新对新的动态数据进行渲染副作用收集
      if (chip.wormhole) {
        cacheIdleJob(() => {
          teardownAbandonedEffects(chip.wormhole)
        }, idleJobs)
      }
    }

    // 新旧子节点序列建立关联关系
    const children: ChipChildren = chip.children
    connectChipChildren(chip.wormhole?.children, children, chip)
    const lastChild = getLastChipChild(children)
    if (lastChild) {
      // 标记节点在同级节点序列中的索引
      lastChild.position = children.length - 1
      // 创建父子关系
      lastChild.parent = chip
      return {
        next: lastChild,
        phase: false
      }
    } else {
      return completeReconcile(chip, renderPayloads, idleJobs)
    }
  }
}

/**
 * 回溯阶段处理 chip 节点对
 * 完成 chip 节点对的 diff，生成渲染描述信息 (render payload)
 * @param chip 
 */
export function completeReconcile(
  chip: Chip,
  renderPayloads: ListAccessor<RenderPayloadNode>,
  idleJobs: ListAccessor<IdleJobUnit>
): ChipTraversePointer {
  const parent: Chip = chip.parent
  // 如果 chip 节点不跳过，则 diff 出更新描述 render payload
  if (!chip.selfSkipable && !chip.skipable) {
    // 优先处理子节点事务，根据收集的待删除子节点生成对应的 render payload
    if (hasDeletions(chip)) {
      genRenderPayloadsForDeletions(chip.deletions, renderPayloads, idleJobs)
    }
    // 生成当前节点 diff 的 render payload 并入队
    reconcileToGenRenderPayload(chip, parent, renderPayloads)
    // 指定类型节点完成 reconcile 工作
    renderInstrumentations[chip.chipType].onCompleteReconcile(chip)
  }

  // 获取下一组需要处理的 chip 节点对
  const prevIndex: number = chip.position - 1
  const prevSibling: Chip = parent.children[prevIndex]
  if (prevSibling) {
    // 标记节点在同级节点序列中的索引
    prevSibling.position = prevIndex
    // 创建父子关系
    prevSibling.parent = parent
    return {
      next: prevSibling,
      phase: false
    }
  } else {
    return {
      next: parent,
      phase: true
    }
  }
}

/**
 * 初始化原生 dom 节点的协调工作
 * @param chip 
 * @param renderPayloads
 */
export function initReconcileForElement(
  chip: Chip,
  renderPayloads: ListAccessor<RenderPayloadNode>
): void {
  if (!chip.wormhole) {
    // 生成对应的 dom 容器创建 render payload
    cacheRenderPayload(
      createRenderPayloadNode(
        RenderActions.CREATE_ELEMENT,
        (chip.tag as string),
        null,
        null,
        null,
        chip,
        null,
        null,
        (context: Chip, elm: Element) => {
          // 当前 render payload commit 之后，将创建的 dom 容器
          // 挂载到 chip 上下文上，便于子节点挂载时能够访问到对应的父 dom 容器
          context.elm = elm
        }
      ),
      renderPayloads
    )
  }
}

/**
 * 初始化自定义组件的协调工作
 * @param chip 
 */
export function initReconcileForComponent(chip: Chip): void {
  // 优先复用相同类型组件节点的 instance，节省内存，但 refs & props 需要更新，
  // 因为子代节点 & 外部属性都具有不确定性，因此需要使用最新的数据
  if (chip.wormhole) {
    // 存在相似节点，复用旧节点数据
    reuseVirtualChipState(chip, chip.wormhole)
  } else {
    // 无相似节点，创建全新的节点实例
    chip.instance = createComponentInstance((chip.tag as Component), chip)
  }

  disableCollecting()
  mountComponentChildren(chip)
  enableCollecting()
}

/**
 * 初始化条件节点的协调工作
 * @param chip 
 */
export function initReconcileForConditionChip(chip: Chip): void {
  if (chip.wormhole) {
    reuseVirtualChipState(chip, chip.wormhole)
  } else {
    chip.instance = createVirtualChipInstance(chip)
  }

  createRenderEffectForConditionChip(chip, chip.instance.render)
}

/**
 * 初始化可迭代节点的协调工作
 * @param chip 
 */
export function initReconcileForIteratorChip(chip: Chip): void {
  if (chip.wormhole) {
    reuseVirtualChipState(chip, chip.wormhole)
  } else {
    chip.instance = createVirtualChipInstance(chip)
  }

  const {
    sourceGetter, // 数据源 getter，数据源本身可能为根级响应式数据，也可能为其他响应式数据源的子级数据
    render // 模板渲染器
  } = chip.instance
  createRenderEffectForIteratorChip(chip, render, sourceGetter)
}

/**
 * 完成自定义组件对应的回溯阶段协调工作
 * @param chip 
 */
export function completeReconcileForComponent(chip: Chip): void {
  // 缓存视图改变的生命周期 (mounted | updated)，reconcile 阶段仅是数据层面的处理，
  // 未发生实际的视图渲染，因此需要将生命周期缓存至队列，commit 阶段后再批量执行
  const inst = (chip.instance as ComponentInstance)
  if (chip.wormhole) {
    // 组件类型节点存在旧的相似节点，走更新逻辑，缓存组件的 updated 
    // 生命周期到全局生命周期缓存队列
    // todo 生命周期逻辑
  } else {
    // 组件类型节点无对应的相似节点，走挂载逻辑，缓存组件的 mounted
    // 生命周期到全局生命周期缓存队列
    // todo 生命周期逻辑
  }
}

/**
 * 建立 chip 子节点之间的映射关系，并生成部分子代节点对应的 render payload
 * 主要涉及:
 * 1. 旧子节点的移除
 * 2. 新子节点的挂载
 * 3. 新旧子节点的成对匹配
 * 4. 新子节点的位置移动
 * @param oldChildren 
 * @param newChildren 
 */
export function connectChipChildren(
  oldChildren: ChipChildren,
  newChildren: ChipChildren,
  parent: Chip
): void {
  // todo 待删除子节点 render payload 创建、收容；
  // 子节点移动创建 render payload，并将其挂载到需要移动的 chip 上，等该
  // chip 进入回溯阶段再进行 render payload 的派发
  if (oldChildren === null) {
    // 无旧子节点，不做节点成对匹配
    return
  }

  if (newChildren === null) {
    // 无新子节点，不做节点成对匹配，但需要记录需要在回溯阶段移除的旧节点
    parent.deletions = [...oldChildren]
    return
  }

  // 新旧子节点序列均为常规的非空序列，进行新旧节点序列间的成对匹配
  let s1: number = 0
  let s2: number = 0
  let e1: number = oldChildren.length - 1
  let e2: number = newChildren.length - 1
  const boundary: number = Math.max(e1, e2)

  // 1. 序列头预处理
  //    序列头部向后遍历，按照遍历指针匹配新旧子节点
  while (s1 <= boundary) {
    const c1: Chip = oldChildren[s1]
    const c2: Chip = newChildren[s2]
    if (isSameChip(c1, c2)) {
      c2.wormhole = c1
      s1++
      s2++
    } else {
      break
    }
  }

  // 2. 序列尾预处理
  //    序列尾部向前遍历，按照遍历指针匹配新旧子节点
  while (e1 >= s1 && e2 >= s2) {
    const c1: Chip = oldChildren[e1]
    const c2: Chip = newChildren[e2]
    if (isSameChip(c1, c2)) {
      c2.wormhole = c1
      e1--
      e2--
    } else {
      break
    }
  }

  // 3. 旧节点序列全部预处理完毕，但新节点序列存在未匹配节点子序列
  //    新节点序列中的未匹配子序列全部节点需做挂载，不需要匹配
  if (s1 > e1) {
    return
  }

  // 4. 新节点序列全部预处理完毕，但旧节点序列存在未匹配节点子序列
  //    旧节点序列中的未匹配子序列全部节点需移除，将这部分待移除的节点
  //    缓存到新的父节点，等到回溯到此父节点时再生成对应的节点移除
  //    render payload
  if (s2 > e2) {
    for (let i = s1; i <= e1; i++) {
      cacheDeletions(parent, oldChildren[i])
    }

    return
  }

  // 5. 非空不可预测新旧子序列匹配
  const keyToIndex: Record<ChipKey, number> = createEmptyObject()
  const unconnectedUnkeyedMap: Record<number, number> = createEmptyObject()
  const oldToNew: Record<number, number> = createEmptyObject()
  let lastConnectedOldIndex: number | string
  let needMove: boolean = false

  // 建立旧节点 key - index 映射关系，用于新节点匹配对应的旧节点
  for (let i = s1; i <= e1; i++) {
    const { key }: Chip = oldChildren[i]
    if (key) {
      keyToIndex[key] = i
    } else {
      unconnectedUnkeyedMap[i] = i
    }
  }

  for (let i = s2; i <= e2; i++) {
    const newChild: Chip = newChildren[i]
    if (hasOwn(newChild, 'key')) {
      const idx: number = keyToIndex[newChild.key]
      if (
        isNumber(idx) &&
        newChild.tag === oldChildren[idx].tag
      ) {
        newChild.wormhole = oldChildren[idx]
        if (idx < lastConnectedOldIndex) {
          needMove = true
        }
        lastConnectedOldIndex = idx
        oldToNew[idx] = i
      }
    } else {
      for (let idx in unconnectedUnkeyedMap) {
        if (oldChildren[idx].tag === newChild.tag) {
          newChild.wormhole = oldChildren[idx]
          if (idx < lastConnectedOldIndex) {
            needMove = true
          }
          lastConnectedOldIndex = idx
          oldToNew[idx] = i
          deleteProperty(unconnectedUnkeyedMap, idx)
          break
        }
      }
    }
  }

  // 遍历旧节点序列，将待删除的未成对节点记录到父节点，等到回溯阶段
  // 再批量生成对应的 render payload
  for (let i = s1; i <= e1; i++) {
    if (!isNumber(oldToNew[i])) {
      cacheDeletions(parent, oldChildren[i])
    }
  }

  // 计算出需要移动位置的节点，发生位置移动的节点一定是新旧节点成对匹配的
  // 使用最长增长子序列计算出不需移动位置的新节点索引
  const whitelist: Record<number, boolean> | null = needMove ?
    computeUnmovedWhitelist(oldToNew) :
    null
  if (whitelist) {
    for (let i = s2; i <= e2; i++) {
      if (newChildren[i].wormhole && !whitelist[i]) {
        // 未命中无需移动节点白名单，将对应 chip 节点标记为待移动状态
        newChildren[i].move = true
      }
    }
  }
}

/**
 * 缓存要删除的 chip
 * @param parent 
 * @param deletion 
 */
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
 * · 类型、key 均相同的相似节点 (待更新属性 | 待移动位置)
 * · 旧节点为 null，新节点为有效节点 (待挂载新节点)
 * @param chip 
 * @param parentChip 
 * @param renderPayloads
 */
export function reconcileToGenRenderPayload(
  chip: Chip,
  parentChip: Chip,
  renderPayloads: ListAccessor<RenderPayloadNode>
): void {
  const { tag, props, wormhole } = chip
  if (wormhole) {
    // 有匹配的旧节点，且新旧 chip 节点一定是相似节点
    cacheRenderPayload(
      chip.move ? createRenderPayloadNode(
        RenderActions.PATCH_PROP | RenderActions.MOVE, // 更新节点属性 & 将需要移动的节点移动到指定位置
        (tag as string),
        reconcileProps(chip, wormhole),
        wormhole.elm, // 此时新 chip 还未 commit 到 dom，因此获取不到实际的 element 元素
        domOptions.parentNode(wormhole.elm), // 移动节点所需父容器节点
        chip,
        null,
        parentChip.children[chip.position + 1], // 当前 chip 节点的后一个兄弟节点作为移动插入锚点
        (context: Chip, elm: Element) => {
          // render payload 执行完毕后触发，为当前 chip 上下文挂载对应的 dom 节点
          context.elm = elm
        }
      ) : createRenderPayloadNode(
        RenderActions.PATCH_PROP, // 更新节点属性 & 将需要移动的节点移动到指定位置
        (tag as string),
        reconcileProps(chip, wormhole),
        wormhole.elm, // 此时新 chip 还未 commit 到 dom，因此获取不到实际的 element 元素
        null,
        chip,
        null,
        null,
        (context: Chip, elm: Element) => {
          // render payload 执行完毕后触发，为当前 chip 上下文挂载对应的 dom 节点
          context.elm = elm
        }
      ),
      renderPayloads
    )
  } else {
    // 无匹配到的旧 chip 节点，新 chip 为待挂载节点。由于 dive 阶段
    // 已创建生成 dom 容器的 render payload，因此 bubble 阶段需要
    // 完成节点属性的 patch 、节点的挂载，这样才能完整将新的节点挂载
    // 到 dom 上
    if (isString(tag)) {
      // 原生节点，此节点需要挂载到视图上，非原生节点由于没有实体容器，因此
      // 不需要操作视图
      cacheRenderPayload(
        createRenderPayloadNode(
          // 更新节点属性 & 将节点挂载到指定位置
          RenderActions.PATCH_PROP | RenderActions.MOUNT,
          (tag as string),
          props,
          null,
          null,
          chip,
          parentChip.wormhole || parentChip,
          parentChip.children[chip.position + 1]
        ),
        renderPayloads
      )
    } else {
      // 无实体节点的虚拟容器节点，最终不会体现到视图上，无需生成 render payload，
      // 但需要生成用于定位的实体锚点
      cacheRenderPayload(
        createRenderPayloadNode(
          RenderActions.CREATE_ELEMENT | RenderActions.MOUNT,
          'div',
          null,
          null,
          null,
          chip,
          parentChip,
          chip.children?.[0] || parentChip.children[chip.position + 1], // anchor
          (context: Chip, elm: Element) => {
            // render payload 已 commit 到视图，将生成的锚点挂载到虚拟容器上下文上
            context.anchor = elm
          }
        ),
        renderPayloads
      )
    }
  }
}

/**
 * 根据缓存的待删除子节点生成对应的 render payload
 * @param deletions 
 * @param renderPayloads 
 * @param idleJobs 
 */
export function genRenderPayloadsForDeletions(
  deletions: Chip[],
  renderPayloads: ListAccessor<RenderPayloadNode>,
  idleJobs: ListAccessor<IdleJobUnit>
): void {
  for (let i = 0; i < deletions.length; i++) {
    const deletion = deletions[i]
    const elm = deletion.elm
    cacheRenderPayload(
      createRenderPayloadNode(
        RenderActions.UNMOUNT,
        null,
        null,
        elm,
        domOptions.parentNode(elm),
        deletion
      ),
      renderPayloads
    )
  }

  cacheIdleJob(() => {
    teardownDeletions(deletions)
  }, idleJobs)
}

/**
 * 两组 props diff 生成变化 prop 的集合
 * @param newProps 
 * @param oldProps 
 */
export function reconcileProps(
  newChip: Chip,
  oldChip: Chip
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
 * @param queue 
 */
export function cacheRenderPayload(
  payload: RenderPayloadNode,
  queue: ListAccessor<RenderPayloadNode>
): void {
  if (queue.first) {
    queue.last = queue.last.next = payload
  } else {
    queue.last = queue.first = payload
  }
}

/**
 * 复用旧 chip 节点上的数据
 * @param chip 
 */
export function reuseVirtualChipState(chip: Chip, owner: Chip): void {
  chip.instance = owner.instance
  chip.anchor = owner.anchor
}

/**
 * 计算出不需移动的节点白名单
 * @param map 
 */
export function computeUnmovedWhitelist(map: Record<string, number>): Record<string, true> {
  const whitelist: Record<string, true> = createEmptyObject()
  const lis: string[] = []
  // 记录在递增子序列中索引 i 对应的上一元素所对应的索引
  const correctMap: Record<string, string> = createEmptyObject()
  for (const i in map) {
    const value: number = map[i]
    let lastIndex: string = lis[lis.length - 1]
    const lastValue: number = lastIndex ?
      map[lastIndex] :
      -1
    if (value > lastValue) {
      // 当前值大于递增子序列最后一个索引对应的值，满足贪心条件，将该元素
      // 索引记录到递增子序列中，并记录对应的纠正锚点
      lis.push(i)
      if (lis.length > 1) {
        correctMap[i] = lis[lis.length - 2]
      }
    } else {
      // 二分查找递增子序列中小于当前元素且最接近当前元素的索引，保证找到的索引
      // 及之前的索引对应的值能和当前元素组成正确顺序的递增序列
      let start: number = 0
      let end: number = lis.length - 1
      let middle: number
      while (start + 1 < end) {
        middle = (start + end) >> 1
        if (value > map[lis[middle]]) {
          start = middle
        } else {
          end = middle
        }
      }

      // 二分查找后 [0,start] 区间内的子序列元素均小于当前元素，可构成正确顺序的
      // 递增子序列
      lis[end] = i
      correctMap[i] = lis[start]
    }
  }

  // 回溯递增子序列，根据先前得到的索引纠正 map，由后向前递推索引值并更新索引值
  const len: number = lis.length
  whitelist[map[lis[len - 1]]] = true
  for (let i = len - 2; i >= 0; i--) {
      lis[i] = correctMap[lis[i + 1]]
      whitelist[map[lis[i]]] = true
  }

  return whitelist
}
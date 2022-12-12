import { ComponentInstance, Component, LifecycleUnit } from "./component"
import { Effect } from "../../reactivity/src/effect"
import {
  isReservedTag,
  isReservedComponentTag
} from './domOptions';
import { isArray, isFunction, extend } from '../../share/src';
import { RenderPayloadNode } from "./workRender";
import { VirtualInstance, VirtualOptions } from "./virtualChip";
import { ListAccessor } from "../../share/src/shareTypes";
import { LifecycleHooks } from "./lifecycle";

export type ChipTag = | string | Component | VirtualOptions

// 动态属性取值器
export interface DynamicValueGetter {
  (): any
  value?: any // 动态属性取值之后的字面量
  effect?: Effect // 动态属性关联 effect
}

export type StaticValue = string | number

export type ChipPropValue = DynamicValueGetter | StaticValue

export type ChipProps = Record<string, ChipPropValue>

// 框架规定子节点必须已数组的形式声明，以减少不必要的子代节点格式化处理、运行时判断
export type ChipChildren = | Chip[]

export const enum ChipFlags {
  IS_CHIP = '__n_isChip',
  IS_RECONCILE_SCOPE = '__n_isReconcileScope',
  MAY_SKIP = '__n_maySkip'
}

export interface ChipCore {
  tag: ChipTag
  chipType: number
  props: ChipProps
  isSVG?: boolean
  is?: boolean
  children?: ChipChildren
  parent?: Chip
}

export const enum ChipTypes {
  INVALID_NODE = -1,
  NATIVE_DOM = 0,
  RESERVED_COMPONENT = 1,
  CUSTOM_COMPONENT = 2,
  CONDITION = 3,
  FRAGMENT = 4
}

export const ChipTypeNames = {
  [ChipTypes.INVALID_NODE]: 'INVALID_NODE',
  [ChipTypes.NATIVE_DOM]: 'NATIVE_DOM',
  [ChipTypes.RESERVED_COMPONENT]: 'RESERVED_COMPONENT',
  [ChipTypes.CUSTOM_COMPONENT]: 'CUSTOM_COMPONENT'
}

export type ChipInstance = ComponentInstance | VirtualInstance

export interface ChipRef {

}

export interface ChipEffectUnit {
  effect: Effect
  next: ChipEffectUnit
}

export interface IdleJobUnit {
  job: Function
  next: IdleJobUnit
}

export type ChipUnit = Chip | Chip | null

export type ChipKey = string | number

// chip 是每个节点 (native dom | component) 的独立上下文，
// 与节点本身共存，节点销毁时 chip 上下文一并销毁，并需要对上
// 下文持有的状态进行清理 (节点所属 effects 一定要清理，防止后续
// 操作数据时错误触发无效的 effect)
export interface Chip extends ChipCore {
  readonly [ChipFlags.IS_CHIP]: true

  readonly id: number // 节点编号 id (自增)
  ref: ChipRef
  key?: ChipKey
  elm: Element // 虚拟节点对应的实际 dom 容器
  move?: true // 节点是否需要移动
  instance: ChipInstance
  directives?: unknown
  components?: unknown
  source?: unknown // 生成当前节点的源数据，仅可迭代节点的单元节点会有该属性
  selfSkipable?: true // 标记 chip 节点本身是否可跳过 reconcile
  skipable?: true // 标记 chip 节点及其子代是否全部可跳过 reconcile
  deletions?: Chip[] // 缓存当前 chip 下需要删除的一级子 chip
  // 存储节点对应的所有 effect，用于 chip 上下文销毁时对 effect 
  // 进行靶向移除
  effects?: ListAccessor<ChipEffectUnit>
  renderPayloads?: ListAccessor<RenderPayloadNode> // 用于存储新旧子节点匹配过程中产生的 render payload，如节点移动行为
  position?: number // chip 节点在子节点序列中的索引位置

  // pointers
  // 连接存在映射关系的新旧 chip 节点的通道指针
  wormhole: ChipUnit

  // flags
  compileFlags?: number
  // 标记当前 chip 节点在 commit 阶段需要触发的 effect 类型
  effectFlags?: number
}

// nuker 的虚拟根节点
export interface ChipRoot {
  // chip 根节点
  root: Chip
  // reconcile & commit 阶段产生的闲时任务队列
  idleJobs: ListAccessor<IdleJobUnit> | void
  // 渲染描述载荷队列
  renderPayloads: ListAccessor<RenderPayloadNode>

  // 改变视图生命周期的缓存队列
  [LifecycleHooks.MOUNTED]?: ListAccessor<LifecycleUnit>
  [LifecycleHooks.UPDATED]?: ListAccessor<LifecycleUnit>
}

let id = 0

export function parseChipType(tag: ChipTag): number {
  if (typeof tag === 'string') {
    if (isReservedTag(tag)) {
      return ChipTypes.NATIVE_DOM
    }
    return ChipTypes.INVALID_NODE
  } else if (typeof tag === 'object') {
    if (isReservedComponentTag(tag)) {
      return ChipTypes.RESERVED_COMPONENT
    }
    return ChipTypes.CUSTOM_COMPONENT
  }
  return ChipTypes.INVALID_NODE
}

export function cloneChip(chip: Chip, props: object, children: ChipChildren): Chip {
  return {
    [ChipFlags.IS_CHIP]: true,
    tag: chip.tag,
    key: chip.key,
    chipType: chip.chipType,
    props: extend({}, chip.props, props),
    children: children || chip.children,
    id: chip.id,
    instance: chip.instance,
    ref: chip.ref,
    wormhole: chip.wormhole,
    elm: chip.elm
  }
}

export function isSameChip(vn1: Chip, vn2: Chip) {
  return vn1.tag === vn2.tag && vn1.key === vn2.key
}

/**
 * 返回指定位置的 chip 子节点
 * @param children 
 * @param index 
 */
export function getChipChild(children: Chip[], index: number = 0): Chip {
  return children[index]
}

/**
 * 返回 chip 的最后一个子节点
 * @param children 
 */
export function getLastChipChild(children: ChipChildren): Chip {
  if (isArray(children)) {
    // array children
    return getChipChild(children, children.length - 1)
  } else {
    // invalid children
    return null
  }
}

/**
 * chip 节点是否为指定 chip 的最后一个子节点
 * @param child 
 * @param parent 
 */
export function isLastChildOfChip(target: Chip, chip: Chip): boolean {
  const children: ChipChildren = chip.children
  return target === children[children.length - 1]
}

export function createChipRoot(root: Chip): ChipRoot {
  return {
    root,
    idleJobs: null,
    renderPayloads: null,
    // 改变视图生命周期的缓存队列
    [LifecycleHooks.MOUNTED]: null,
    [LifecycleHooks.UPDATED]: null
  }
}

export function createChip(
  tag: ChipTag,
  props?: ChipProps,
  children?: ChipChildren
): Chip {
  const chipType = parseChipType(tag)
  return {
    [ChipFlags.IS_CHIP]: true,
    id: id++,
    tag,
    props,
    children,
    ref: null,
    elm: null,
    instance: null,
    chipType,
    directives: [],
    components: [],
    wormhole: null
  }
}

/**
 * 获取 chip 属性值的字面量
 * @param valueContainer 
 */
export function getPropLiteralValue(valueContainer: ChipPropValue): StaticValue {
  return isFunction(valueContainer) ? valueContainer.value : valueContainer
}
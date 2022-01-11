import { ComponentInstance, Component, LifecycleUnit } from "./component"
import { Effect } from "../../reactivity/src/effect"
import {
  isReservedTag,
  isReservedComponentTag
} from './domOptions';
import { isObject, isArray, isString, isNumber, isFunction } from '../../share/src';
import { RenderPayloadNode, ChildrenRenderer } from "./workRender";
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

export type ChipChildren = | Chip | Chip[] | ChildrenRenderer

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

export const enum ChipPhases {
  PENDING = 0,
  INITIALIZE = 1,
  COMPLETE = 2
}

export type ChipUnit = Chip | Chip | null

export type ChipKey = string | number | symbol

// chip 是每个节点 (native dom | component) 的独立上下文，
// 与节点本身共存，节点销毁时 chip 上下文一并销毁，并需要对上
// 下文持有的状态进行清理 (节点所属 effects 一定要清理，防止后续
// 操作数据时错误触发无效的 effect)
export interface Chip extends ChipCore {
  [ChipFlags.IS_CHIP]: true
  [ChipFlags.IS_RECONCILE_SCOPE]?: boolean // 标识是否是局部 diff 的 chip 域

  id: number // 节点编号 id (自增)
  ref: ChipRef
  key?: ChipKey
  elm: Element | null
  instance: ChipInstance | null
  directives?: unknown
  components?: unknown
  maySkip?: boolean // chip 及其子代在 reconcile 阶段有可能被跳过
  // 当前已转化为 chip 的 Chip child 索引，用于辅助 chip 树
  // 遍历过程中动态创建新的 chip
  currentChildIndex?: number
  deletions?: Chip[] // 缓存当前 chip 下需要删除的一级子 chip
  // 存储节点对应的所有 effect，用于 chip 上下文销毁时对 effect 
  // 进行靶向移除
  effects?: ListAccessor<ChipEffectUnit>
  renderPayloads?: ListAccessor<RenderPayloadNode>

  // pointers
  // chip 树中仅包含动态节点，在生成 chip 树时会将 dom 树
  // 中存在动态内容的节点连接成一颗 chip 链表树
  parent: Chip
  prevSibling: ChipUnit
  nextSibling: ChipUnit
  firstChild?: ChipUnit
  lastChild?: ChipUnit
  // 连接存在映射关系的新旧 chip 节点的通道指针
  wormhole: ChipUnit

  // flags
  phase?: number
  compileFlags?: number
  // 标记当前 chip 节点在 commit 阶段需要触发的 effect 类型
  effectFlags?: number
}

// nuker 的虚拟根节点
export interface ChipRoot extends Chip {
  // 闲时任务队列
  idleJobs: ListAccessor<IdleJobUnit>
  // 渲染描述载荷队列
  renderPayloads: ListAccessor<RenderPayloadNode>
  // 当前渲染周期内缓存的已失效 effect，这些 effect 将在 idle 阶段被释放
  abandonedEffects: ListAccessor<ChipEffectUnit>
  // chip 树结构是否稳定
  isStable: boolean
  // UI 变化后生命周期的触发策略
  mutableHookStrategy: number

  // 改变视图生命周期的缓存队列
  [LifecycleHooks.MOUNTED]?: ListAccessor<LifecycleUnit>
  [LifecycleHooks.UPDATED]?: ListAccessor<LifecycleUnit>
}

let id = 0

// 在触发源数据变化时触发 chip 更新，nuker 复用一颗 chip tree
export function updateChip(chip: Chip, payload: object): Chip {
  if (isObject(payload)) {
    // update chip from payload
  }

  return null
}

export function removeChip(chip: Chip): boolean {

}

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
  return Object.assign({}, {
    tag: chip.tag,
    data: Object.assign({}, chip.data),
    key: chip.key,
    children: Object.assign({}, chip.children),
    parent: chip.parent,
    elm: chip.elm,
    isComponent: chip.isComponent
  });
}

export function isSameChip(vn1: Chip, vn2: Chip) {
  return vn1.tag === vn2.tag && vn1.key === vn2.key;
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
  } else if (isObject(children)) {
    // single child
    return (children as Chip)
  } else {
    // invalid children
    return null
  }
}

/**
 * 判断 chip 节点是否为最后一个子节点
 * @param chip 
 * @param children 
 */
export function isLastChipChild(chip: Chip, children: ChipChildren): boolean {
  return (getLastChipChild(children) === chip)
}

/**
 * chip 节点是否为指定 chip 的最后一个子节点
 * @param child 
 * @param parent 
 */
export function isLastChildOfChip(child: Chip, parent: Chip): boolean {
  return (child.parent.lastChild === child)
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
    parent: null
    prevSibling: null
    nextSibling: null
    firstChild: null
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

/**
 * 获取 chip 链表树中指向指定 chip 的 chip 节点
 * @param chip 
 */
export function getPointerChip(chip: Chip): Chip {
  const parent: Chip = chip.parent
  if (isLastChildOfChip(chip, parent)) {
    return parent
  } else {
    const children = (parent.children as Chip[])
    for (let i = 0; i < children.length; i++) {
      if (children[i].prevSibling === chip) {
        return children[i]
      }
    }
    return null
  }
}
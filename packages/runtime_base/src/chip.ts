import { ComponentInstance } from "./component"
import { Effect } from "../../reactivity/src/effect"
import {
  isReservedTag,
  isReservedComponentTag
} from './domOptions';
import { isObject, isArray, isString, isNumber } from '../../share/src';
import { RenderPayloadNode, ChildrenRenderer } from "./workRender";
import { VirtualInstance } from "./virtualChip";

export type ChipTag = | string | void

export interface ChipPropNode {
  isDynamic?: boolean
  value: any
}

export type ChipProps = Record<string, ChipPropNode>

export type ChipChildren = Chip | Chip[] | ChildrenRenderer | null

export const enum ChipFlags {
  IS_CHIP = '__n_isChip',
  IS_RECONCILE_SCOPE = '__n_isReconcileScope'
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
  previous: ChipEffectUnit
  next: ChipEffectUnit
}

export interface ContextUpdaterUnit {
  updater: () => void
  previous: ContextUpdaterUnit
  next: ContextUpdaterUnit
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
  // 当前已转化为 chip 的 Chip child 索引，用于辅助 chip 树
  // 遍历过程中动态创建新的 chip
  currentChildIndex?: number
  // 存储节点对应的所有 effect，用于 chip 上下文销毁时对 effect 
  // 进行靶向移除
  effects?: ChipEffectUnit | null
  renderPayloads?: RenderPayloadNode

  // pointers
  // chip 树中仅包含动态节点，在生成 chip 树时会将 dom 树
  // 中存在动态内容的节点连接成一颗 chip 链表树
  parent: Chip
  prevSibling: ChipUnit
  nextSibling: ChipUnit
  firstChild: ChipUnit
  // 连接存在映射关系的新旧 chip 节点的通道指针
  wormhole: ChipUnit

  // flags
  phase?: number
  compileFlags?: number
  // 标记当前 chip 节点在 commit 阶段需要触发的 effect 类型
  effectFlags?: number
}

export interface ChipRoot extends Chip {
  // 整颗 chip 树生成的全部副作用构成的链表队列 (按照由子到父的顺序)
  effects: ChipEffectUnit | null
  // chip 树渲染信息更新任务队列
  cotextUpdaters: ContextUpdaterUnit | null
  // 渲染描述载荷队列
  renderPayloads: RenderPayloadNode
  // chip 树结构是否稳定
  isStable: boolean
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

export function getFirstChipChild(children: ChipChildren): Chip {
  if (isObject(children)) {
    // single child
    return (children as Chip)
  } else if (isArray(children)) {
    // array children
    return children[0] ? children[0] : null
  } else if (isString(children) || isNumber(children)) {
    // base text child
  } else {
    return null
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
    parent: null
    prevSibling: null
    nextSibling: null
    firstChild: null
    wormhole: null
  }
}
import {
  VNodeCore,
  VNodeProps,
  VNode
} from "./vnode"
import { BaseListNode } from "../../share/src/shareTypes"
import { ComponentInstance } from "./component"
import { isObject } from "../../share/src"
import { Effect } from "../../reactivity/src/effect"

export const IS_CHIP = Symbol()

export interface ChipInstance {

}

export interface ChipRef {

}

export interface ChipEffectUnit {
  effect: Effect
  previous: ChipEffectUnit
  next: ChipEffectUnit
}

export const enum ChipPhases {
  PENDING = 0,
  INITIALIZE = 1,
  COMPLETE = 2
}

export type ChipUnit = Chip | VNode | null

// chip 是每个节点 (native dom | component) 的独立上下文，
// 与节点本身共存，节点销毁时 chip 上下文一并销毁，并需要对上
// 下文持有的状态进行清理 (节点所属 effects 一定要清理，防止后续
// 操作数据时错误触发无效的 effect)
export interface Chip extends VNodeCore {
  [IS_CHIP]: true

  id: number // 节点编号 id (自增)
  hostNode: unknown
  ref: ChipRef
  key: string | number | symbol
  elm: Element | null
  instance: ComponentInstance | null
  directives?: unknown
  components?: unknown
  // 当前已转化为 chip 的 VNode child 索引，用于辅助 chip 树
  // 遍历过程中动态创建新的 chip
  currentChildIndex?: number
  // 存储节点对应的所有 effect，用于 chip 上下文销毁时对 effect 
  // 进行靶向移除
  effects?: ChipEffectUnit | null

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
  effectFlags: number
}

export interface ChipRoot extends Chip {
  hasMounted: boolean
  // 整颗 chip 树生成的全部副作用构成的链表队列 (按照由子到父的顺序)
  effects: ChipEffectUnit | null
}

// 在触发源数据变化时触发 chip 更新，nuker 复用一颗 chip tree
export function updateChip(chip: Chip, payload: object): Chip {
  if (isObject(payload)) {
    // update chip from payload
  }

  return null
}

export function removeChip(chip: Chip): boolean {

}
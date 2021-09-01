import {
  VNodeCore,
  VNodeProps,
  VNode
} from "./vnode"
import { BaseListNode } from "../../share/src/shareTypes"
import { ComponentInstance } from "./component"
import { isObject } from "../../share/src"

export const IS_CHIP = Symbol()

export interface ChipInstance {

}

export interface ChipRef {

}

export interface ChipEffectUnit extends BaseListNode {
  effect: Function
}

export const enum ChipPhases {
  PENDING = 0,
  INITIALIZE = 1,
  COMPLETE = 2
}

export type ChipUnit = Chip | VNode | null
document.createElement
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
  level?: number // 当前 chip 节点在树中所处层级标记
  // 当前已转化为 chip 的 VNode child 索引，用于辅助 chip 树
  // 遍历过程中动态创建新的 chip
  currentChildIndex?: number

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
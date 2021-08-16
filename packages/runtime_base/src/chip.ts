import {
  VNodeCore,
  VNodeProps
} from "./vnode"
import { BaseListNode } from "../../share/src/shareTypes"
import { ComponentInstance } from "./component"

export const IS_CHIP = Symbol()

export interface ChipInstance {

}

export interface ChipRef {

}

export interface ChipEffectUnit extends BaseListNode {
  effect: Function
}

export interface Chip extends VNodeCore {
  [IS_CHIP]: true

  id: number // 节点编号 id (自增)
  hostNode: unknown
  ref: ChipRef
  key: string | number | symbol
  instance: ComponentInstance | null
  directives?: unknown
  components?: unknown
  level?: number // 当前 chip 节点在树中所处层级标记

  // pointers
  // chip 树中仅包含动态节点，在生成 chip 树时会将 dom 树
  // 中存在动态内容的节点连接成一颗 chip 链表树
  parent: Chip
  prevSibling: Chip | null
  nextSibling: Chip | null
  firstChild: Chip | null
  // 连接存在映射关系的新旧 chip 节点的通道指针
  wormhole: Chip | null

  // flags
  compileFlags?: number
  // 标记当前 chip 节点在 commit 阶段需要触发的 effect
  effectFlags: number

  effects: ChipEffectUnit | null
}

export interface ChipRoot extends Chip {
  hasMounted: boolean
}

export const enum VNodeTypes {
  INVALID_NODE = -1,
  NATIVE_DOM = 0,
  RESERVED_COMPONENT = 1,
  CUSTOM_COMPONENT = 2
}

export const VNodeTypeNames = {
  [VNodeTypes.INVALID_NODE]: 'INVALID_NODE',
  [VNodeTypes.NATIVE_DOM]: 'NATIVE_DOM',
  [VNodeTypes.RESERVED_COMPONENT]: 'RESERVED_COMPONENT',
  [VNodeTypes.CUSTOM_COMPONENT]: 'CUSTOM_COMPONENT'
}

export function parseVNodeType(tag: VNodeTag): number {
  if (typeof tag === 'string') {
    if (isReservedTag(tag)) {
      return VNodeTypes.NATIVE_DOM
    }
    return VNodeTypes.INVALID_NODE
  } else if (typeof tag === 'object') {
    if (isReservedComponentTag(tag)) {
      return VNodeTypes.RESERVED_COMPONENT
    }
    return VNodeTypes.CUSTOM_COMPONENT
  }
  return VNodeTypes.INVALID_NODE
}

export function cloneVNode(vnode: VNode, props: object, children: VNodeChildren) {
  return Object.assign({}, {
    tag: vnode.tag,
    data: Object.assign({}, vnode.data),
    key: vnode.key,
    children: Object.assign({}, vnode.children),
    parent: vnode.parent,
    elm: vnode.elm,
    isComponent: vnode.isComponent
  });
}

export function isSameVNode(vn1: VNode, vn2: VNode) {
  return vn1.tag === vn2.tag && vn1.key === vn2.key;
}

export function createVNode(
  tag: VNodeTag,
  props?: VNodeProps,
  children?: VNodeChildren,
  patchFlag?: number
): VNode {
  const vnodeType = parseVNodeType(tag)
  return {
    tag,
    props,
    children,
    patchFlag,
    elm: null,
    ref: null,
    vnodeType,
    instance: null,
    directives: [],
    components: [],

    parent: null,
    nextSibling: null
  }
}
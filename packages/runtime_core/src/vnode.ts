import {
  isReservedTag,
  isReservedComponentTag
} from '@nuker/domOptions';

export type VNodeTag = | string | void

export interface VNodeProps {
  key?: string | number,
  ref?: string
}

export interface VNodeChildren {
  
}

export type VNodeRef = | string

export const enum VNodeFlags {
  IS_VNODE = '__n_isVNode'
}

export interface VNode {
  [VNodeFlags.IS_VNODE]: true

  tag: VNodeTag
  props: VNodeProps
  children: VNodeChildren

  elm: unknown
  ref: VNodeRef
  key: string | number | symbol
  vnodeType: number
  instance: unknown
  directives: unknown
  components: unknown

  parent: VNode | null
  nextSibling: VNode | null
  firstChild: VNode | null

  patchFlag: number
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
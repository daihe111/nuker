import { VNode } from './vNode';

export function cloneVNode(vNode) {
  return Object.assign({}, {
    tag: vNode.tag,
    data: Object.assign({}, vNode.data),
    key: vNode.key,
    children: Object.assign({}, vNode.children),
    parent: vNode.parent,
    elm: vNode.elm,
    isComponent: vNode.isComponent
  });
}

export function isSameVNode(vn1, vn2) {
  return vn1.tag === vn2.tag && vn1.key === vn2.key;
}

export function createVNode(tag, data, children) {
  const vNode = new VNode(tag, data, children);

  return vNode;
}

// reflect vNode to really dom
export function reflect() {

}
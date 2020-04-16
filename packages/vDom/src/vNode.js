import { isReservedTag } from '@nuker/domoptions';

export class VNode {
  constructor(tag, data, children) {
    this.tag = tag; // tag of vNode
    this.data = data; // data of dom, include attrs, handlers, etdAttrs
    this.key  = data.key; // key of vNode
    this.children = children; // children vNode
    this.parent = undefined; // parent vNode
    this.elm = undefined; // reference of really dom
    this.key = data.key; // key of vNode
    this.isComponent = !isReservedTag(this.tag); // if vNode is a component
    this.dirty = false; // if vNode is dirty
    this.isChanged = false; // if vNode is changed
  }

  // reference of really dom
  get element() {
    return this.elm;
  }
}
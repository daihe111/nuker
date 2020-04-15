export class VDom {
  constructor(tag, data, children) {
    this.tag = tag; // tag of vDom
    this.data = data; // data of dom
    this.children = children; // children vDom
    this.parent = undefined; // parent vDom
    this.elm = undefined; // reference of really dom
    this.key = data.key; // key of vDom
  }

  // reference of really dom
  get element() {
    return this.elm;
  }
}
import { VNode, createVNode } from "./vnode"
import { patch } from "./patch"

export function setupApp(App: any) {
  const appContext = {
    _vnode: null,

    render(Component: any, props: object, container: string) {
      const vnode1: VNode | null = appContext._vnode
      const vnode2: VNode | null = createVNode(Component, props)
      container = getDomContainer(container)
      patch(vnode1, vnode2, container)
    },


  }
  return appContext
}
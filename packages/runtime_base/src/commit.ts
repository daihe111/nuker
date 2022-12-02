import { RenderPayloadNode, RenderUpdateTypes } from "./workRender";
import { domOptions } from "./domOptions";
import { isFunction } from "../../share/src";

// 待删除 prop 的占位标志位
export const PROP_TO_DELETE = Symbol()

/**
 * payload 链表节点在 reconcile 阶段按照由子到父的顺序插入，commit 时
 * 按照先后顺序执行 payload 节点，即可保证 commit 的执行顺序与 reconcile 一致
 * @param chipRoot 
 */
export function performCommitWork(renderPayloads: RenderPayloadNode): null {
  let currentPayload = renderPayloads
  let i = 0
  while (currentPayload !== null) {
    try {
      commitRenderPayload(currentPayload)
      currentPayload = currentPayload.next
    } catch (e) {
      // 当前 commit 任务失败，重试 3 次，重试次数达到后继续执行后面的任务
      if (++i > 2) {
        currentPayload = currentPayload.next
        i = 0
      }
    }
  }

  return null
}

/**
 * 将渲染载荷提交到真正的 dom 上
 * @param renderPayload 
 */
export function commitRenderPayload({
  action,
  tag,
  props,
  container,
  parentContainer,
  context,
  parentContext,
  anchorContext,
  callback
}: RenderPayloadNode): void {
  const elm = container || context.elm

  if (action & RenderUpdateTypes.PATCH_PROP) {
    // commit 属性到 dom
    commitProps(elm, props)
  }

  if (action & RenderUpdateTypes.MOUNT) {
    commitMountMutation(
      elm,
      parentContainer || parentContext.elm,
      anchorContext.elm
    )
  }

  if (action & RenderUpdateTypes.UNMOUNT) {
    commitUnmountMutation(
      elm,
      domOptions.parentNode(elm)
    )
  }

  if (action & RenderUpdateTypes.MOVE) {
    commitMoveMutation(
      elm,
      parentContainer || parentContext.elm,
      anchorContext.elm
    )
  }

  if (action & RenderUpdateTypes.CREATE_ELEMENT) {
    commitNewElement(tag)
  }

  if (isFunction(callback)) {
    callback(context, elm)
  }
}

/**
 * 创建新的 dom 容器
 * @param tag 
 */
export function commitNewElement(tag: string): Element {
  const isSVG = (tag === 'svg')
  return domOptions.createElement(tag, isSVG, false)
}

/**
 * 将 props patch 到真实的 dom 上
 * @param container 
 * @param props 
 */
export function commitProps(container: Element, props: object): Element {
  if (container && props) {
    for (const propName in props) {
      const value: symbol | any = props[propName]
      if (value === PROP_TO_DELETE) {
        domOptions.removeAttribute(container, propName)
      } else {
        try {
          domOptions.setAttribute(container, propName, `${value}`)
        } catch (e) {
          // TODO 属性值格式化 string 错误时进行报错提示
        }
      }
    }

    return container
  } else {
    return null
  }
}

/**
 * 向真实 dom 挂载全新的节点
 * @param target
 * @param parentContainer 
 * @param anchorContainer 
 */
export function commitMountMutation(
  target: Element,
  parentContainer: Element,
  anchorContainer?: Element
): Element {
  if (target && parentContainer) {
    if (anchorContainer) {
      domOptions.insert(target, parentContainer, anchorContainer)
    } else {
      domOptions.appendChild(target, parentContainer)
    }

    return target
  } else {
    return null
  }
}

/**
 * 将目标节点从真实 dom 上卸载
 * @param target 
 * @param parentContainer 
 * @param context 
 */
export function commitUnmountMutation(
  target: Element,
  parentContainer: Element
): Element {
  if (parentContainer && target) {
    domOptions.remove(target, parentContainer)
    return target
  } else {
    return null
  }
}

/**
 * dom 节点移动位置
 * @param target 
 * @param parentContainer 
 * @param anchor 
 */
export function commitMoveMutation(
  target: Element,
  parentContainer: Element,
  anchor: Element
) {
  if (target && parentContainer) {
    const clone: Element = domOptions.cloneNode(target)
    domOptions.remove(target, parentContainer)
    if (anchor) {
      // 有锚点往锚点前插入
      domOptions.insert(clone, parentContainer, anchor)
    } else {
      // 无锚点将目标节点插入到序列的末尾
      domOptions.appendChild(clone, parentContainer)
    }

    return target
  } else {
    return null
  }
}
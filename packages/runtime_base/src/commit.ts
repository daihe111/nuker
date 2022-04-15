import { RenderPayloadNode, RenderUpdateTypes } from "./workRender";
import { domOptions } from "./domOptions";
import { Chip, ChipRoot } from "./chip";
import { performConcurrentIdleWork, cacheConcurrentIdleJob } from "./idle";
import { isFunction } from "../../share/src";

// 待删除 prop 的占位标志位
export const PROP_TO_DELETE = Symbol()

/**
 * payload 链表节点在 reconcile 阶段按照由子到父的顺序插入，commit 时
 * 按照先后顺序执行 payload 节点，即可保证 commit 的执行顺序与 reconcile 一致
 * @param chipRoot 
 */
export function performCommitWork(chipRoot: ChipRoot): null {
  let currentPayload = chipRoot.renderPayloads?.first
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

  // 已派发 render payloads 清理
  const clearJob: Function = () => {
    chipRoot.renderPayloads = null
  }
  cacheConcurrentIdleJob(clearJob, chipRoot)

  // 进入 idle 阶段，批量执行闲时任务，如 chip 信息
  // 更新任务、过期信息清理任务...
  performConcurrentIdleWork(chipRoot)
  return null
}

/**
 * 将渲染描述载荷提交到真正的 dom 上
 * @param renderPayload 
 */
export function commitRenderPayload(renderPayload: RenderPayloadNode): void {
  const {
    type,
    tag,
    props,
    container,
    parentContainer,
    anchorContainer,
    context,
    auxiliaryContext,
    callback
  } = renderPayload
  let target: Element

  if (type & RenderUpdateTypes.PATCH_PROP) {
    // commit 属性到 dom
    target = commitProps(
      container || context.elm,
      props
    )
  }

  if (type & RenderUpdateTypes.MOUNT) {
    target = commitMountMutation(
      container || context.elm,
      parentContainer || context.parent.elm,
      anchorContainer || auxiliaryContext.elm
    )
  }

  if (type & RenderUpdateTypes.UNMOUNT) {
    target = commitUnmountMutation(
      container,
      parentContainer,
      context
    )
  }

  if (type & RenderUpdateTypes.MOVE) {
    target = commitMoveMutation(
      container,
      parentContainer,
      anchorContainer
    )
  }

  if (type & RenderUpdateTypes.CREATE_ELEMENT) {
    target = commitNewElement(tag)
  }

  if (isFunction(callback)) {
    callback(context, target)
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
  parentContainer: Element,
  context: Chip
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
  if (target && parentContainer && anchor) {
    const clone: Element = domOptions.cloneNode(target)
    domOptions.remove(target, parentContainer)
    domOptions.insert(clone, parentContainer, anchor)

    return target
  } else {
    return null
  }
}
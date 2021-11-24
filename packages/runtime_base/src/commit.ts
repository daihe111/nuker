import { RenderPayloadNode, RenderUpdateTypes } from "./workRender";
import { domOptions } from "./domOptions";
import { Chip, ChipRoot } from "./chip";
import { performIdleWork } from "./idle";
import { registerJob } from "./scheduler";

// 待删除 prop 的占位标志位
export const PROP_TO_DELETE = Symbol()

// payload 链表节点在 render 阶段按照由子到父的顺序插入，commit 时
// 按照先后顺序遍历 commit payload 节点，即可保证 commit 的执行顺序
export function performCommitWork(chipRoot: ChipRoot): void {
  let currentPayload = chipRoot.renderPayloads
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

  // 进入 idle 阶段，批量执行闲时任务，如 chip 信息更新任务
  registerJob(performIdleWork.bind(null, chipRoot))
}

// 将渲染描述载荷提交到真正的 dom 上
export function commitRenderPayload(renderPayload: RenderPayloadNode): void {
  const {
    type,
    tag,
    props,
    container,
    parentContainer,
    anchorContainer,
    context,
    auxiliaryContext
  } = renderPayload
  if (type & RenderUpdateTypes.PATCH_PROP) {
    // commit 属性到 dom
    commitProps(container, props)
  }

  if (type & RenderUpdateTypes.MOUNT) {
    commitMountMutation(
      tag,
      props,
      parentContainer || context.parent.elm,
      anchorContainer || auxiliaryContext.elm
    )
  }

  if (type & RenderUpdateTypes.UNMOUNT) {
    commitUnmountMutation(container, parentContainer, context)
  }

  if (type & RenderUpdateTypes.MOVE) {
    commitMoveMutation(container, parentContainer, anchorContainer)
  }
}

/**
 * 将 props patch 到真实的 dom 上
 * @param container 
 * @param props 
 */
export function commitProps(container: Element, props: object) {
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
  }
}

/**
 * 向真实 dom 挂载全新的节点
 * @param tag 
 * @param props 
 * @param parentContainer 
 * @param anchorContainer 
 */
export function commitMountMutation(
  tag: string,
  props: object,
  parentContainer: Element,
  anchorContainer?: Element
) {
  if (parentContainer) {
    const isSVG = tag === 'svg'
    const child = domOptions.createElement(tag, isSVG, false)
    commitProps(child, props)
    if (anchorContainer) {
      domOptions.insert(child, parentContainer, anchorContainer)
    } else {
      domOptions.appendChild(child, parentContainer)
    }
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
) {
  if (parentContainer && target) {
    domOptions.remove(target, parentContainer)
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
  }
}
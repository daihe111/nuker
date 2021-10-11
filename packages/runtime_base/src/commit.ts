import { RenderPayloadNode, RenderFlags, RenderUpdateTypes, completeChip } from "./workRender";
import { isObject, isEmptyObject } from "../../share/src";
import { domOptions } from "./domOptions";
import { Chip, ChipPhases } from "./chip";
import { teardownEffect, Effect } from "../../reactivity/src/effect";

// payload 链表节点在 render 阶段按照由子到父的顺序插入，commit 时
// 按照先后顺序遍历 commit payload 节点，即可保证 commit 的执行顺序
export function commitRenderPayloads(payloadRoot: RenderPayloadNode): void {
  let currentPayload = payloadRoot
  while (currentPayload !== null) {
    commitRenderPayload(currentPayload)
    currentPayload = currentPayload.next
  }
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
    context
  } = renderPayload
  if (type & RenderUpdateTypes.PATCH_PROP) {
    // commit 属性到 dom
    commitProps(container, props)
  }

  if (type & RenderUpdateTypes.MOUNT) {
    commitMountMutation(tag, props, parentContainer, anchorContainer)
  }

  if (type & RenderUpdateTypes.UNMOUNT) {
    commitUnmountMutation(container, parentContainer, context)
  }

  if (type & RenderUpdateTypes.MOVE) {
    commitMoveMutation(container, parentContainer, anchorContainer)
  }
}

export function commitProps(container: Element, props: object) {
  if (container && isObject(props) && !isEmptyObject(props)) {
    for (const key in props) {
      container.setAttribute(key, props[key])
    }
  }
}

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

export function commitUnmountMutation(
  target: Element,
  parentContainer: Element,
  context: Chip
) {
  if (parentContainer && target) {
    domOptions.remove(target, parentContainer)
    // 进行对应 chip context 清理
    clearChipContext(context)
  }
}

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

export function clearChipContext(context: Chip) {
  let currentEffect = context.effects
  while (currentEffect !== null) {
    // 将当前 effect 从依赖仓库中卸载
    teardownEffect(currentEffect.effect)
    currentEffect = currentEffect.next
  }

  // 将 chip context 从树中移除
  const {
    prevSibling: previous,
    nextSibling: next
  } = context
  if (previous) {
    previous.nextSibling = next
    if (next) {
      next.prevSibling = previous
    }
  } else {
    next.prevSibling = null
    context.parent.firstChild = next
  }
  context.parent = context.prevSibling = context.nextSibling = null
}




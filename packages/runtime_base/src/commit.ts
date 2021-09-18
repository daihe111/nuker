import { RenderPayloadNode, RenderFlags, RenderUpdateTypes, completeChip } from "./workRender";
import { isObject, isEmptyObject } from "../../share/src";
import { domOptions } from "./domOptions";

export const enum TraversePhases {
  CALL = 0,
  RECALL = 1
}

let ongoingRenderPayload: RenderPayloadNode

// payload 和 chip 一样是一颗链表树 (有向图)
// 采用 dive-swim-bubble 算法模型，便于从子代节点进行 commit
export function commitRenderPayloads(payloadRoot: RenderPayloadNode) {
  ongoingRenderPayload = payloadRoot
  while (ongoingRenderPayload !== null) {
    switch (ongoingRenderPayload.phase) {
      case TraversePhases.CALL:
        // 回溯遍历
        ongoingRenderPayload = completeRenderPayload(ongoingRenderPayload)
        ongoingRenderPayload.phase = TraversePhases.RECALL
        break
      case TraversePhases.RECALL:
        // do nothing
        break
      default:
        // 首次遍历节点
        if (ongoingRenderPayload.firstChild) {
          ongoingRenderPayload = ongoingRenderPayload.firstChild
        } else {
          ongoingRenderPayload = completeRenderPayload(ongoingRenderPayload)
          ongoingRenderPayload.phase = TraversePhases.RECALL
        }

        ongoingRenderPayload.phase = TraversePhases.CALL
        break
    }
  }
}

export function completeRenderPayload(renderPayload: RenderPayloadNode): RenderPayloadNode | null {
  if (renderPayload[RenderFlags.IS_RENDER_PAYLOAD]) {
    return null
  }

  const {
    type,
    tag,
    props,
    container,
    parentContainer,
    anchorContainer,
    next
  } = renderPayload
  if (type & RenderUpdateTypes.PATCH_PROP) {
    // commit 属性到 dom
    commitProps(container, props)
  }
  if (type & RenderUpdateTypes.MOUNT) {
    commitMountMutation(tag, props, parentContainer, anchorContainer)
  }

  // 返回下一个需要处理的 RenderPayloadNode
  if (next) {
    if (next[RenderFlags.IS_RENDER_PAYLOAD]) {
      return next
    } else {
      return null
    }
  } else {
    // 同级节点遍历到末端，开始向祖先节点回溯
    return renderPayload.parent
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

import { RenderPayloadNode, RenderFlags, RenderUpdateTypes, completeChip } from "./workRender";
import { isObject, isEmptyObject } from "../../share/src";

export const enum TraversePhases {
  CALL = 0,
  RECALL = 1
}

let ongoingRenderPayload: RenderPayloadNode

// payload 和 chip 一样是一颗链表树 (有向图)
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
  if (
    isObject(props) &&
    !isEmptyObject(props) &&
    type === RenderUpdateTypes.PATCH_PROP
  ) {
    // commit 属性到 dom
    commitProps(container, props)
  }

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

export function commitProps(container: Node, props: object) {
  if (container) {

  }
}
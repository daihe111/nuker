import { Chip } from "./chip";
import { teardownEffect } from "../../reactivity/src/effect";

/**
 * 清理已失效 chip 上下文上的待回收信息
 * @param context 
 */
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

// 用 reconcile 阶段新生成的 chip 子树更新 chip 局部子树，并清理过期状态
export function updateSubChipTree() {

}
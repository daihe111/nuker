import { Chip, ChipProps, ChipChildren, ChipKey, ChipRef, ContextUpdaterUnit } from "./chip";
import { teardownEffect } from "../../reactivity/src/effect";
import { extend, isFunction } from "../../share/src";
import { registerJob } from "./scheduler";

// idle 阶段批量执行 reconcile 阶段产生的信息更新任务，且任务支持调度系统的中断与恢复
export function performContextUpdateWork(updaterRoot: ContextUpdaterUnit): void {
  let currentUpdater: ContextUpdaterUnit = updaterRoot
  while (currentUpdater !== null) {
    registerJob(currentUpdater.updater)
    currentUpdater = currentUpdater.next
  }
}

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
export function updateSubChipTree(chip: Chip): Chip {
  const oldChip: Chip = chip.wormhole
  const { prevSibling, nextSibling, parent }: Chip = oldChip
  oldChip.parent = oldChip.prevSibling = oldChip.nextSibling = null
  parent.firstChild = prevSibling.nextSibling = nextSibling.prevSibling = chip
  chip.parent = parent
  chip.prevSibling = prevSibling
  chip.nextSibling = nextSibling
  return chip
}

// 更新 chip 上下文信息
export function updateChipContext(
  chip: Chip,
  props: ChipProps,
  children: ChipChildren,
  key: ChipKey,
  ...restArgs: any[]
): Chip {
  updateRefs(chip)
  return extend(chip, { props, children, key, ...restArgs })
}

export function updateRefs(chip: Chip): Chip {

}
import { Chip, ChipProps, ChipChildren, ChipKey, IdleJobUnit, ChipRoot } from "./chip";
import { teardownEffect } from "../../reactivity/src/effect";
import { extend, isFunction } from "../../share/src";

export const enum ChipInsertingPositions {
  BEFORE = 0, // 向前插入
  AFTER = 1 // 向后插入
}

// idle 阶段批量执行 reconcile & commit 阶段产生的闲时任务，且任务支持调度系统的中断与恢复，
// 以保证闲时任务不长时间执行阻塞主线程
// reconcile tasks -> commit -> idle 需要作为一个整体任务注册进调度系统，idle 及之前阶段
// 产生的 reconcile 任务须保证排在 idle 任务之后，以保证新的 reconcile 任务执行时能访问到正
// 确的 chip 数据状态，避免数据状态错乱
export function performIdleWork(chipRoot: ChipRoot, onIdleCompleted?: Function): Function {
  // 闲时任务执行单元，作为调度任务的子任务
  function idleJobPerformingUnit(jobNode: IdleJobUnit): Function {
    const { job, next } = jobNode
    try {
      job()
      if (next) {
        return idleJobPerformingUnit.bind(null, next)
      } else {
        // 所有闲时任务均执行完毕，标记调度任务执行完毕，并执行对应的生命周期
        if (isFunction(onIdleCompleted)) {
          onIdleCompleted()
        }
        return null
      }
    } catch (e) {
      // 当闲时任务执行失败时，重试 3 次执行，重试次数达到阈值后，创建
      // 下一任务执行的子任务
      for (let i = 0; i < 3; i++) {
        try {
          job()
        } catch (e) {
          continue
        }
      }

      return idleJobPerformingUnit.bind(null, next)
    }
  }

  return idleJobPerformingUnit.bind(null, chipRoot.idleJobs)
}

// 用 reconcile 阶段新生成的 chip 子树更新 chip 局部子树，并清理过期状态
// 该更新局部 chip 树的方法存在内存隐患，直接替换局部 chip 节点，但是旧的 chip
// 包括其子代 chip 仍然会保持对全局 effect 的引用，因此旧 chip 对应的内存
// 不会被 GC 及时回收，如果要及时释放内存，需要深度遍历旧的 chip，这样会多一次
// 遍历处理成本，因此暂不采用该方案进行局部 chip tree 的更新
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

/**
 * 清理已失效 chip 上下文以及其持有的待回收信息
 * @param context 
 */
export function removeChipContext(context: Chip): void {
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

/**
 * 将新挂载的 chip 上下文插入到 chip 树中
 * @param chip 
 */
export function insertChipContext(chip: Chip, anchorChip: Chip, position: number = ChipInsertingPositions.AFTER): Chip {
  updateRefs(chip)
  // 将 chip 插入 chip tree
  if (position === ChipInsertingPositions.BEFORE) {
    // 向前插入
    const previous: Chip = anchorChip.prevSibling
    if (previous) {
      previous.nextSibling = anchorChip.prevSibling = chip
      chip.prevSibling = previous
      chip.nextSibling = anchorChip
    } else {
      // 锚点为首个子节点
      chip.nextSibling = anchorChip
      anchorChip.prevSibling = chip
    }
  } else {
    // 向后插入
    const next: Chip = anchorChip.nextSibling
    if (next) {
      next.prevSibling = anchorChip.nextSibling = chip
      chip.prevSibling = anchorChip
      chip.nextSibling = next
    } else {
      // 锚点为最后一个子节点
      chip.prevSibling = anchorChip
      anchorChip.nextSibling = chip
    }
  }

  return chip
}

export function updateRefs(chip: Chip): Chip {

}

/**
 * 将闲时任务缓存至闲时任务队列
 * @param job 
 * @param chipRoot 
 */
export function cacheIdleJob(job: Function, chipRoot: ChipRoot): Function {
  const root: IdleJobUnit = chipRoot.idleJobs
  if (root) {
    const lastNode: IdleJobUnit = root.previous
    if (lastNode) {
      root.previous = lastNode.next = {
        job,
        previous: lastNode,
        next: root
      }
    } else {
      root.previous = root.next = {
        job,
        previous: root,
        next: root
      }
    }
  } else {
    chipRoot.idleJobs = {
      job,
      previous: null,
      next: null
    }
  }

  return job
}
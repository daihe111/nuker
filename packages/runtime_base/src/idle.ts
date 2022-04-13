import { Chip, ChipProps, ChipChildren, ChipKey, IdleJobUnit, ChipRoot, ChipEffectUnit } from "./chip";
import { teardownEffect } from "../../reactivity/src/effect";
import { extend, isFunction } from "../../share/src";
import { invokeLifecycle, LifecycleHooks } from "./lifecycle";
import { ListAccessor } from "../../share/src/shareTypes";

export const enum IdleTypes {
  CONCURRENT = 0, // concurrent 渲染任务产生的闲时任务
  SYNC = 1 // 同步渲染任务产生的闲时任务
}

// TODO 已废弃
// 原因:
//    1. commit 视图变化后需要立即将当前批次 commit 产生的闲时任务全部执行完，且中途不可打断，
//       保证试图渲染后所有涉及到的状态信息及时同步到对应的 virtual dom 上
//    2. concurrent 渲染模式下，commit 视图变化后不希望插入其他渲染任务，如果插入，会导致
//       被重置后的任务多次执行相同的 commit 视图操作，这显然是不允许的
// idle 阶段批量执行 reconcile & commit 阶段产生的闲时任务，且任务支持调度系统的中断与恢复，
// 以保证闲时任务不长时间执行阻塞主线程
// reconcile tasks -> commit -> idle 需要作为一个整体任务注册进调度系统，idle 及之前阶段
// 产生的 reconcile 任务须保证排在 idle 任务之后，以保证新的 reconcile 任务执行时能访问到正
// 确的 chip 数据状态，避免数据状态错乱
function performIdleWorkConcurrently(chipRoot: ChipRoot, onIdleCompleted?: Function): Function {
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
        // 清空闲时任务队列
        if (chipRoot.concurrentIdleJobs) {
          chipRoot.concurrentIdleJobs = null
        }

        // 批量触发当前渲染周期内缓存的视图改变后的生命周期 (mounted | updated)
        [LifecycleHooks.MOUNTED, LifecycleHooks.UPDATED].forEach((n: string) => {
          invokeLifecycle(n, chipRoot)
          chipRoot[n] = null
        })
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

  // 卸载缓存的已失效 effects
  teardownAbandonedEffects(chipRoot)
  // 清除已废弃 effect 缓存
  chipRoot.abandonedEffects = null
  // 执行第一个闲时任务，并返回下一个要执行的闲时任务
  return idleJobPerformingUnit(chipRoot.concurrentIdleJobs?.first)
}

/**
 * 批量执行显示任务队列中的任务并清空队列，每次执行时队列中的任务会收敛为一个不可打断的同步任务
 * @param chipRoot 
 * @param type 
 */
export function performIdleWork(chipRoot: ChipRoot, type: number): boolean {
  const accessor: ListAccessor<IdleJobUnit> = (type === IdleTypes.CONCURRENT ?
    chipRoot.concurrentIdleJobs :
    (type === IdleTypes.SYNC ?
      chipRoot.syncIdleJobs :
      null))
  if (!accessor?.first) {
    return
  }

  // 批量执行闲时任务
  let currentUnit: IdleJobUnit = accessor.first
  while (currentUnit !== null) {
    currentUnit.job()
    currentUnit = currentUnit.next
  }

  // 执行完闲时任务后清空对应的任务队列
  switch (type) {
    case IdleTypes.CONCURRENT:
      chipRoot.concurrentIdleJobs = null
      break
    case IdleTypes.SYNC:
      chipRoot.syncIdleJobs = null
      break
    default:
      // do nothing, an error type has been passed in
      break
  }
}

// 用 reconcile 阶段新生成的 chip 子树更新 chip 局部子树，并清理过期状态
// 该更新局部 chip 树的方法存在内存隐患，直接替换局部 chip 节点，但是旧的 chip
// 包括其子代 chip 仍然会保持对全局 effect 的引用，因此旧 chip 对应的内存
// 不会被 GC 及时回收，如果要及时释放内存，需要深度遍历旧的 chip，这样会多一次
// 遍历处理成本，因此暂不采用该方案进行局部 chip tree 的更新
export function updateSubChipTree(chip: Chip, anchorContext: Chip): Chip {
  const oldChip: Chip = chip.wormhole
  if (anchorContext.lastChild === oldChip) {
    anchorContext.lastChild = chip
    chip.parent = anchorContext
    chip.prevSibling = oldChip.prevSibling
  } else {
    anchorContext.prevSibling = chip
    chip.parent = oldChip.parent
    chip.prevSibling = oldChip.prevSibling
  }

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
export function removeChipContext(context: Chip, lastContext: Chip): void {
  // 将 chip context 从树中移除
  if (lastContext === context.parent) {
    context.parent.firstChild = context.prevSibling
  } else {
    lastContext.prevSibling = context.prevSibling
  }
}

/**
 * 将新挂载的 chip 上下文插入到 chip 树中
 * @param chip 
 */
export function insertChipContext(context: Chip, anchorContext: Chip, isLast: boolean): Chip {
  // 将 chip 插入 chip tree
  if (isLast) {
    context.parent = anchorContext
    context.prevSibling = anchorContext.firstChild
    anchorContext.firstChild = context
  } else {
    context.prevSibling = anchorContext.prevSibling
    context.parent = anchorContext.parent
    anchorContext.prevSibling = context
  }

  return context
}

/**
 * 替换 chip 树中的指定 chip 节点
 * @param newContext 
 * @param oldContext 
 * @param anchorContext 
 */
export function replaceChipContext(
  newContext: Chip,
  oldContext: Chip,
  anchorContext: Chip
): Chip {
  if (oldContext.parent === anchorContext) {
    // 子节点中的最后一个节点
    anchorContext.lastChild = newContext
    newContext.parent = anchorContext
    newContext.prevSibling = oldContext.prevSibling
  } else {
    // 非子节点中的最后一个节点
    anchorContext.prevSibling = newContext
    newContext.prevSibling = oldContext.prevSibling
    newContext.parent = anchorContext.parent
  }

  return newContext
}

export function updateRefs(chip: Chip): void {

}

/**
 * 将闲时任务缓存至闲时任务队列
 * @param job 
 * @param chipRoot 
 */
export function cacheIdleJob(job: Function, chipRoot: ChipRoot, type: number): Function {
  const idleJobs = (type === IdleTypes.CONCURRENT ?
    chipRoot.concurrentIdleJobs :
    (type === IdleTypes.SYNC ?
      chipRoot.syncIdleJobs :
      null))
  const jobNode = {
    job,
    next: null
  }
  if (idleJobs) {
    idleJobs.last = idleJobs.last.next = jobNode
  } else {
    switch (type) {
      case IdleTypes.CONCURRENT:
        chipRoot.concurrentIdleJobs = {
          first: jobNode,
          last: jobNode
        }
        break
      case IdleTypes.SYNC:
        chipRoot.syncIdleJobs = {
          first: jobNode,
          last: jobNode
        }
        break
      default:
        // do nothing, an error type has been passed in
        break
    }
  }

  return job
}

/**
 * idle 阶段将本轮 reconcile 缓存的无效 effect 进行集中卸载
 * @param chipRoot 
 */
export function teardownAbandonedEffects(chipRoot: ChipRoot): void {
  const effects = chipRoot.abandonedEffects
  let currentUnit: ChipEffectUnit = effects.first
  while (currentUnit !== null) {
    teardownEffect(currentUnit.effect)
    currentUnit = currentUnit.next
  }
}
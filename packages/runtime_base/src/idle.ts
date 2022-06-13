/**
 * 1. commit 视图变化后需要立即将当前批次 commit 产生的闲时任务全部执行完，且中途不可打断，
 *    保证试图渲染后所有涉及到的状态信息及时同步到对应的 virtual dom 上
 * 2. concurrent 渲染模式下，commit 视图变化后不希望插入其他渲染任务，如果插入，会导致
 *    被重置后的任务多次执行相同的 commit 视图操作，这显然是不允许的
 * idle 阶段批量执行 reconcile & commit 阶段产生的闲时任务，且任务支持调度系统的中断与恢复，
 * 以保证闲时任务不长时间执行阻塞主线程
 * reconcile tasks -> commit -> idle 需要作为一个整体任务注册进调度系统
 */

import { Chip, ChipProps, ChipChildren, ChipKey, IdleJobUnit, ChipRoot, ChipEffectUnit } from "./chip";
import { teardownEffect } from "../../reactivity/src/effect";
import { extend, createListAccessor, isArray } from "../../share/src";
import { invokeLifecycle, LifecycleHooks } from "./lifecycle";
import { ListAccessor } from "../../share/src/shareTypes";
import { unregisterJob } from "./scheduler";

/**
 * 执行闲时任务，每次执行时队列中的任务会收敛为一个不可打断的同步任务
 * @param chipRoot 
 */
export function performIdleWork(chipRoot: ChipRoot): void {
  flushIdle(chipRoot.idleJobs)
  // 批量触发当前渲染周期内缓存的视图改变后的生命周期 (mounted | updated)
  [LifecycleHooks.MOUNTED, LifecycleHooks.UPDATED].forEach((n: string) => {
    invokeLifecycle(n, chipRoot)
  })
  teardownChipCache(chipRoot)
}

/**
 * 批量执行闲时任务
 * @param accessor 
 */
function flushIdle(accessor: ListAccessor<IdleJobUnit> | void): boolean {
  if (!accessor || !accessor.first) {
    return false
  }

  // 批量执行闲时任务
  let currentUnit: IdleJobUnit = accessor.first
  while (currentUnit !== null) {
    currentUnit.job()
    currentUnit = currentUnit.next
  }
  return true
}

/**
 * 用 reconcile 阶段新生成的 chip 子树更新 chip 局部子树，并清理过期状态
 * 该更新局部 chip 树的方法存在内存隐患，直接替换局部 chip 节点，但是旧的 chip
 * 包括其子代 chip 仍然会保持对全局 effect 的引用，因此旧 chip 对应的内存
 * 不会被 GC 及时回收，如果要及时释放内存，需要深度遍历旧的 chip，这样会多一次
 * 遍历处理成本，因此暂不采用该方案进行局部 chip tree 的更新
 * @param chip 
 * @param anchorContext 
 */
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

/**
 * 更新 chip 上下文信息
 * @param chip 
 * @param props 
 * @param children 
 * @param key 
 * @param restArgs 
 */
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

function createIdleNode(job: Function): IdleJobUnit {
  return {
    job,
    next: null
  }
}

/**
 * 将闲时任务缓存至闲时任务队列
 * @param job 
 * @param chipRoot 
 */
export function cacheIdleJob(job: Function, chipRoot: ChipRoot): Function {
  const idleJobs: ListAccessor<IdleJobUnit> | void = chipRoot.idleJobs
  const jobNode: IdleJobUnit = createIdleNode(job)
  if (idleJobs) {
    idleJobs.last = idleJobs.last.next = jobNode
  } else {
    chipRoot.idleJobs = createListAccessor<IdleJobUnit>(jobNode)
  }

  return job
}

function clearChipCacheByKey(chipRoot: ChipRoot, key: string): void {
  chipRoot[key] = null
}

/**
 * 卸载 chip 根节点上的全局渲染缓存信息
 * @param chipRoot 
 */
export function teardownChipCache(chipRoot: ChipRoot): void {
  ([
    'reconcileIdleJobs',
    'renderPayloads',
    LifecycleHooks.MOUNTED,
    LifecycleHooks.UPDATED
  ] as const).forEach(key => {
    clearChipCacheByKey(chipRoot, key)
  })
}

/**
 * 批量卸载 effect
 * @param chipRoot 
 */
export function teardownAbandonedEffects(chip: Chip): void {
  const effects = chip.effects
  let currentUnit: ChipEffectUnit = effects.first
  while (currentUnit !== null) {
    // 将 effect 从依赖仓库、调度队列中移除
    teardownEffect(currentUnit.effect)
    unregisterJob(currentUnit.effect)
    currentUnit = currentUnit.next
  }
  chip.effects = null
}

/**
 * 将已移除 chip 节点上的状态信息卸载
 * @param deletion 
 */
export function teardownDeletion(deletion: Chip): void {
  teardownAbandonedEffects(deletion)
  const children: ChipChildren = deletion.children
  if (isArray(children)) {
    // array chips
    for (let i = 0; i < children.length; i++) {
      teardownAbandonedEffects(children[i])
    }
  }
}

/**
 * 1. commit 视图变化后需要立即将当前批次 commit 产生的闲时任务全部执行完，且中途不可打断，
 *    保证试图渲染后所有涉及到的状态信息及时同步到对应的 virtual dom 上
 * 2. concurrent 渲染模式下，commit 视图变化后不希望插入其他渲染任务，如果插入，会导致
 *    被重置后的任务多次执行相同的 commit 视图操作，这显然是不允许的
 * idle 阶段批量执行 reconcile & commit 阶段产生的闲时任务，且任务支持调度系统的中断与恢复，
 * 以保证闲时任务不长时间执行阻塞主线程
 * reconcile tasks -> commit -> idle 需要作为一个整体任务注册进调度系统
 */

import { Chip, ChipProps, ChipChildren, IdleJobUnit, ChipRoot, ChipEffectUnit, ChipTypes } from "./chip";
import { teardownEffect } from "../../reactivity/src/effect";
import { extend, isArray, addNodeToList } from "../../share/src";
import { invokeLifecycle, LifecycleHooks } from "./lifecycle";
import { ListAccessor } from "../../share/src/shareTypes";
import { unregisterJob } from "./scheduler";

/**
 * 执行闲时任务，每次执行时队列中的任务会收敛为一个不可打断的同步任务
 * @param chipRoot 
 */
export function performIdleWork(idleJobs: IdleJobUnit, ): void {
  flushIdle(idleJobs)
}

/**
 * 批量执行闲时任务
 * @param accessor 
 */
function flushIdle(queue: IdleJobUnit): void {
  // 批量执行闲时任务
  let currentUnit: IdleJobUnit = queue
  while (currentUnit !== null) {
    currentUnit.job()
    currentUnit = currentUnit.next
  }
}

/**
 * 更新 chip 上下文信息
 * @param chip 
 * @param props 
 * @param children 
 * @param restArgs 
 */
export function updateChipContext(
  chip: Chip,
  props: ChipProps,
  children: ChipChildren,
  ...restArgs: any[]
): Chip {
  if (chip.chipType === ChipTypes.CUSTOM_COMPONENT) {
    // 组件类型的 chip 由于子代节点可能变化，因此需要更新子代节点的引用
    updateRefs(chip)
  }

  return extend(chip, { props, children, ...restArgs })
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
export function cacheIdleJob(job: Function, idleJobs: ListAccessor<IdleJobUnit>): Function {
  addNodeToList(idleJobs, createIdleNode(job))
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
 * 批量卸载已移除 chip 上的状态信息
 * @param deletions 
 */
export function teardownDeletions(deletions: Chip[]): void {
  for (let i = 0; i < deletions.length; i++) {
    teardownDeletion(deletions[i])
  }
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
      teardownDeletion(children[i])
    }
  }
}

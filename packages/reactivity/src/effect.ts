import { Job } from "../../runtime_base/src/scheduler"
import { isFunction } from "../../share/src"

export interface EffectWhiteListItem {
  source: object
  key: unknown
}

export interface EffectOptions {
  lazy?: boolean // 是否开启惰性模式
  collectWhenLazy?: boolean // 惰性 effect 是否需要做收集
  effectType?: number
  whiteList?: Array<EffectWhiteListItem> // 仅包含于白名单中的 key 才会触发 effect 收集操作
  scheduler?: (task: Effect) => void
  onCollected?: () => void
  onDispatched?: () => void
  onRunned?: () => void
}

export interface Effect<T = any> extends EffectOptions, Job<T> {
  (): T
  isEffect: boolean
  effectType?: number // 标记 effect 的类型，用于外部根据该类型做统计分析
  id?: number | string
  isActive: boolean
  stores: Set<Set<Effect>>
  collector: (ctx: Effect) => T
  dispatcher: (result: T, ctx: Effect) => unknown
  [key: string]: any
}

export const enum CollectingFlags {
  COLLECTING_CLOSED = 0,
  COLLECTING_OPENED = 1
}

export const enum ReactiveActionTypes {
  GET = 0,
  ADD = 1,
  DELETE = 2,
  UPDATE = 3,
  HAS = 4,
  CLEAR = 5,
  ITERATE = 6
}

export const ITERATE_PROXY_KEYS = {
  BASE_ITERATE_KEY: Symbol('base iterate key'),
  ARRAY_ITERATE_KEY: 'length',
  MAP_KEY_ITERATE_KEY: Symbol('map iterate key'),
  COLLECTION_VALUE_ITERATE_KEY: Symbol('collection value iterate key')
}

let id = 0
let currentEffect: Effect | null = null
const effectStack = []
const store = new WeakMap()
// 全局 effect 收集开关
let collectingFlag = CollectingFlags.COLLECTING_OPENED

// 收集时需要做什么，派发时需要做什么
export function effect<T = any>(
  collector: (ctx: Effect) => T, // 传入 collector 旨在保证拦截器收集到正确的 effect，防止收集到与数据不对应的 effect
  dispatcher: (data: T, ctx: Effect) => unknown,
  options: EffectOptions = {}
): Effect {
  const effect: Effect = createEffect(collector, dispatcher, options)
  if (options.lazy) {
    // effect 为惰性，不立即执行
    if (options.collectWhenLazy) {
      pushEffect(effect)
      collector(effect)
      popEffect()
    }
  } else {
    // effect 立即执行
    effect()
  }
  return effect
}

// 向目标 effect 注入信息
export function injectIntoEffect(effect: Effect, key: string, value: any): Effect {
  effect[key] = value
  return effect
}

export function pushEffect(effect: Effect): void {
  currentEffect = effect
  effectStack.push(currentEffect)
}

export function popEffect(): void {
  effectStack.pop()
  currentEffect = effectStack[effectStack.length - 1]
}

export function createEffect<T = any>(
  collector: (ctx: Effect) => T,
  dispatcher: (data: T, ctx: Effect) => T,
  options: EffectOptions = {}
): Effect {
  const runner = (effect: Effect): T => {
    // TODO 派发时额外的执行工作 (依赖清理工作)
    pushEffect(effect)
    // 只取值，触发 getter
    const result = collector(effect)
    popEffect()
    // 不能取值，防止取值时 trap 收集到错误的 effect，仅触发取值外的其他副作用
    disableCollecting()
    dispatcher(result, effect)
    enableCollecting()
    options.onRunned && options.onRunned()
    return result
  }
  const effect: Effect = (): T => {
    if (!effect.isActive) {
      return
    }
    return runner(effect)
  }

  effect.isEffect = true
  effect.collector = collector
  effect.dispatcher = dispatcher
  effect.stores = new Set()
  effect.lazy = options.lazy
  effect.effectType = options.effectType
  effect.whiteList = options.whiteList
  effect.scheduler = options.scheduler
  effect.onCollected = options.onCollected
  effect.onDispatched = options.onDispatched
  effect.isActive = true
  effect.id = `__n_Effect_${id++}`
  return effect
}

// e.g. effect process steps:
// pushEffect -> collector(collect -> dispatch -> collect -> dispatch ...)
// -> popEffect -> disableCollecting -> dispatcher -> enableCollecting
export function collect(
  target: object,
  key: unknown,
  type: number
) {
  if (collectingFlag === CollectingFlags.COLLECTING_CLOSED) {
    return
  }

  store.has(target) ? store.get(target) : store.set(target, new Map())
  const targetMap: Map<typeof key, Set<Effect>> = store.get(target)
  targetMap.has(key) ? targetMap.get(key) : targetMap.set(key, new Set())
  const effects: Set<Effect> = targetMap.get(key)
  if (
    (!currentEffect.whiteList ||
    isInWhiteList(target, key, currentEffect.whiteList)) &&
    currentEffect &&
    !effects.has(currentEffect)
  ) {
    // effect 被收集的条件:
    // 1. 数据源、属性 key 命中 effect 的收集白名单
    // 2. 被收集 effect 本身有效
    // 3. effect 未被收集当当前 source - key 对应的依赖仓库
    effects.add(currentEffect)
    currentEffect.stores.add(effects)
    currentEffect.onCollected && currentEffect.onCollected()
  }
}

export function dispatch(
  target: object,
  key: unknown,
  type: number,
  oldValue?: unknown,
  value?: unknown
) {
  store.has(target) ? store.get(target) : store.set(target, new Map())
  const targetMap: Map<typeof key, Set<Effect>> = store.get(target)
  targetMap.has(key) ? targetMap.get(key) : targetMap.set(key, new Set())
  const effects: Set<Effect> = targetMap.get(key)
  effects.forEach((effect) => {
    // 避免在 collector 中出现当前 effect 无限触发的情况
    if (effect !== currentEffect) {
      isFunction(effect.scheduler) ? effect.scheduler(effect) : effect()
      effect.onDispatched && effect.onDispatched()
    }
  })
}

// 数据源、属性 key 是否命中白名单
export function isInWhiteList(
  source: object,
  key: unknown,
  whiteList: EffectWhiteListItem[]
): boolean {
  let ret = false
  for (let i = 0; i < whiteList.length; i++) {
    const { source: src, key: k } = whiteList[i]
    if (source === src && key === k) {
      ret = true
      break
    }
  }

  return ret
}

export function teardownEffect(effect: Effect) {
  const stores = effect.stores
  stores.forEach(s => {
    s.delete(effect)
  })
}

/**
 * 禁用响应式系统收集行为
 */
export function disableCollecting() {
  collectingFlag = CollectingFlags.COLLECTING_CLOSED
}

/**
 * 开启响应式系统收集行为
 */
export function enableCollecting() {
  collectingFlag = CollectingFlags.COLLECTING_OPENED
}
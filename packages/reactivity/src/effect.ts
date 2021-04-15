export interface EffectOptions {
  lazy?: boolean,
  scheduler?: (task: unknown) => void,
  onCollected?: () => void,
  onDispatched?: () => void,
  onRunned?: () => void
}

export interface Effect<T = any> extends EffectOptions {
  (): T,
  isEffect: boolean,
  id: number,
  isActive: boolean,
  stores: Set<Set<Effect>>,
  collector: () => T,
  dispatcher: (result: T) => T
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
  ITERATE = 5
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
  collector: () => T, // 传入 collector 旨在保证拦截器收集到正确的 effect，防止收集到与数据不对应的 effect
  dispatcher: () => T,
  options: EffectOptions = {}
): Effect {
  const effect: Effect = createEffect(collector, dispatcher, options)
  if (!options.lazy) {
    effect()
  }
  return effect
}

export function createEffect<T = any>(
  collector: () => T,
  dispatcher: (result: T) => T,
  options: EffectOptions = {}
): Effect {
  const runner = (effect: Effect): T => {
    // TODO 派发时额外的执行工作 (依赖清理工作)
    currentEffect = effect
    effectStack.push(currentEffect)
    // 只取值，触发 getter
    const result = collector()
    effectStack.pop()
    currentEffect = effectStack[effectStack.length - 1]
    // 不能取值，防止取值时 trap 收集到错误的 effect，仅触发取值外的其他副作用
    disableCollecting()
    dispatcher(result)
    enableCollecting()
    options.onRunned && options.onRunned()
    return result
  }
  const effect: Effect = () => {
    if (!effect.isActive) {
      return
    }
    if (options.scheduler) {
      options.scheduler(runner)
      return
    }
    return runner(effect)
  }

  effect.isEffect = true
  effect.collector = collector
  effect.dispatcher = dispatcher
  effect.stores = new Set()
  effect.lazy = options.lazy
  effect.scheduler = options.scheduler
  effect.onCollected = options.onCollected
  effect.onDispatched = options.onDispatched
  effect.isActive = true
  effect.id = id++
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
  if (currentEffect && !effects.has(currentEffect)) {
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
      effect()
      effect.onDispatched && effect.onDispatched()
    }
  })
}

export function disableCollecting() {
  collectingFlag = CollectingFlags.COLLECTING_CLOSED
}

export function enableCollecting() {
  collectingFlag = CollectingFlags.COLLECTING_OPENED
}
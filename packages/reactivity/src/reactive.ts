
import { isObject, getRawType } from '../../share/src'
import { createBaseHandlers } from './baseHandlers'
import { createCollectionHandlers } from './collectionHandlers'
import { createDateHandlers } from './dateHandlers'


export interface ProxyHandlers {
  get?: (target: Target, key: string | symbol, receiver: object) => any,
  set?: (
    target: Target,
    key: string | symbol,
    value: unknown,
    receiver: object
  ) => boolean,
  has?: (target: Target, key: string | symbol) => boolean,
  ownKeys?: (target: Target) => (string | number | symbol)[],
  defineProperty?: (
    target: Target,
    key: string | symbol,
    descripters: object
  ) => boolean,
  deleteProperty?: (target: Target, key: string | symbol) => boolean
}

export const enum ReactiveFlags {
  IS_SKIP = '__n_isSkip',
  IS_ACTIVE = '__n_isActive',
  IS_REACTIVE = '__n_isReactive',
  IS_SHALLOW = '__n_isShallow',
  RAW = '__n_raw',
  PROXY = '__n_proxy'
}

export const enum ReactiveProxyStatus {
  DEACTIVE = 0,
  ACTIVE = 1
}

export interface ReactiveProxy {
  readonly [ReactiveFlags.IS_REACTIVE]: boolean,
  [ReactiveFlags.IS_ACTIVE]?: boolean,
  [ReactiveFlags.IS_SHALLOW]?: boolean,
  [ReactiveFlags.RAW]: object
}

export interface Target {
  [ReactiveFlags.IS_SKIP]?: boolean,
  [ReactiveFlags.PROXY]?: ReactiveProxy
}

export interface ReactiveOptions {
  isShallow?: boolean
}

// target - ReactiveProxy Map
export const proxyCache = new WeakMap<Target, any>()
// ReactiveProxy - isActive Map
export const proxyStatusCache = new WeakMap<ReactiveProxy, number>()

export function reactive(
  target: Target, 
  options: ReactiveOptions = {}
): any {
  if (!isObject(target)) {
    return target
  }

  if (target[ReactiveFlags.IS_SKIP]) {
    return target
  }

  if ((target as ReactiveProxy)[ReactiveFlags.IS_REACTIVE]) {
    return target
  }

  const cache = proxyCache.get(target)
  if (cache) {
    return cache
  }

  const reactiveProxy = new Proxy(
    target,
    matchProxyHandlers(target, options)
  )
  target[ReactiveFlags.PROXY] = reactiveProxy as ReactiveProxy
  proxyCache.set(target, reactiveProxy)
  proxyStatusCache.set(reactiveProxy as ReactiveProxy, ReactiveProxyStatus.ACTIVE)
  return reactiveProxy
}

export function matchProxyHandlers(
  target: Target,
  options: ReactiveOptions
): ProxyHandlers {
  const rawType = getRawType(target)
  switch (rawType) {
    case 'Object':
    case 'Array':
      return createBaseHandlers(options)
    case 'Date':
      return createDateHandlers(options)
    case 'Map':
    case 'WeakMap':
    case 'Set':
    case 'WeakSet':
      return createCollectionHandlers(options)
    default:
      return {}
  }
}

export function getRaw<T>(val: T): T {
  return isObject(val) && val[ReactiveFlags.RAW] ?
    getRaw(val[ReactiveFlags.RAW]) :
    val
}
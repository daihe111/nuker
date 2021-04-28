import {
  collect,
  dispatch,
  ITERATE_PROXY_KEYS,
  ReactiveActionTypes
} from './effect'
import {
  reactive,
  ReactiveFlags,
  ReactiveOptions,
  Target,
  proxyCache,
  ProxyHandlers,
  proxyStatusCache,
  ReactiveProxy,
  getRaw
} from './reactive'
import {
  isObject,
  hasOwn,
  isArray,
  createEmptyObject,
  hasChanged
} from '../../share/src'
import { reactiveInstrumentations } from './reactiveHelpers'

export interface PropertyDescriptor {
  configurable?: boolean;
  enumerable?: boolean;
  value?: any;
  writable?: boolean;
  get?: () => any;
  set?: (v: any) => void;
}

const arrayInstrumentations: Record<string, Function> = createEmptyObject()
(['indexOf', 'lastIndexOf', 'include'] as const).forEach((fnName: string) => {
  arrayInstrumentations[fnName] = function(...args: any[]) {
    const target: Array<any> = args[args.length - 2]
    for (let i = 0, len = target.length; i < len; i++) {
      collect(target, i, ReactiveActionTypes.GET)
    }

    // 1. 优先按照参数入参值进行查找，如果查找到的话则直接返回查询结果
    // 2. 如果入参值没有查询到，并且处于非 shallow 模式，则按照入参值的原始值去查找；
    // 如果处于 shallow 模式，直接返回入参值的查找结果
    const rawMethod: Function = Array.prototype[fnName]
    const isShallow: boolean = args[args.length - 1]
    const rawArgs = args.slice(0, -2)
    const res = rawMethod.call(target, ...rawArgs)
    if ((res === true || res !== -1) || isShallow) {
      return res
    }
    return rawMethod.call(target, ...args.map(arg => getRaw(arg)))
  }
})

(['every', 'filter', 'find', 'findIndex'] as const).forEach((fnName: string) => {
  arrayInstrumentations[fnName] = function(
    callback: Function,
    thisArg: object,
    target: Array<any>,
    isShallow: boolean
  ) {
    for (let i = 0, len = target.length; i < len; i++) {
      collect(target, i, ReactiveActionTypes.GET)
    }
    const rawMethod: Function = Array.prototype[fnName]
    const cb = function(value: any, index: number, array: Array<any>) {
      const res: boolean = callback.call(thisArg, value, index, array)
      if (res || isShallow) {
        return res
      }
      return callback.call(thisArg, getRaw(value), index, array)
    }
    return rawMethod.call(target, callback, thisArg)
  }
})

function createGetter(isShallow: boolean = false) {
  return function get(target: Target, key: string | symbol, receiver: object) {
    // Proxy 属性拦截访问
    // effect 收集仅支持通过 target 对应的 proxy 本身访问触发，从而保障不同 handler 之间
    // 数据行为同步
    if (proxyCache.get(target) !== receiver) {
      return Reflect.get(target, key, receiver)
    }

    if (key === ReactiveFlags.RAW) {
      return target
    } else if (key === ReactiveFlags.IS_ACTIVE) {
      return proxyStatusCache.get(receiver as ReactiveProxy)
    } else if (key === ReactiveFlags.IS_REACTIVE) {
      return true
    } else if (key === ReactiveFlags.IS_SHALLOW) {
      return isShallow
    }

    if (hasOwn(reactiveInstrumentations, key)) {
      return Reflect.get(reactiveInstrumentations, key, receiver).bind(receiver)
    }

    // handle of Array
    if (isArray(target) && hasOwn(arrayInstrumentations, key)) {
      return Reflect.get(
        arrayInstrumentations,
        key,
        receiver
      ).bind(null, target, isShallow)
    }

    const value = Reflect.get(target, key, receiver)
    if (!receiver[ReactiveFlags.IS_ACTIVE]) {
      return value
    }

    collect(target, key, ReactiveActionTypes.GET)
    
    if (!isShallow && isObject(value)) {
      return reactive(value, { isShallow })
    }
    return value
  }
}

function createSetter(isShallow: boolean = false) {
  return function set(
    target: Target, 
    key: string | symbol, 
    value: unknown, 
    receiver: object
  ) {
    if (!receiver[ReactiveFlags.IS_ACTIVE]) {
      return Reflect.set(target, key, value, receiver)
    }

    // 禁止非 target 对应 proxy 本身触发 effect 派发，以保证数据行为的一致性
    if (proxyCache.get(target) !== receiver) {
      return Reflect.set(target, key, value, receiver)
    }

    let oldValue = target[key]
    let newValue = value
    if (!isShallow) {
      oldValue = getRaw(oldValue)
      newValue = getRaw(newValue)
    }

    const isAdd = !hasOwn(target, key)
    if (isAdd) {
      dispatch(target, key, ReactiveActionTypes.ADD, oldValue, newValue)
    } else if (hasChanged(newValue, oldValue)) {
      dispatch(target, key, ReactiveActionTypes.UPDATE, oldValue, newValue)
    }

    return Reflect.set(target, key, value, receiver)
  }
}

export function has(target: Target, key: string | symbol): boolean {
  const hasKey = Reflect.has(target, key)
  if (proxyCache.get(target)[ReactiveFlags.IS_ACTIVE] && hasKey) {
    collect(target, key, ReactiveActionTypes.HAS)
  }
  return hasKey
}

export function ownKeys(target: Target): (string | number | symbol)[] {
  if (proxyCache.get(target)[ReactiveFlags.IS_ACTIVE]) {
    collect(
      target,
      isArray(target) ? 
        ITERATE_PROXY_KEYS.ARRAY_ITERATE_KEY :
        ITERATE_PROXY_KEYS.BASE_ITERATE_KEY,
        ReactiveActionTypes.ITERATE
    )
  }
  return Reflect.ownKeys(target)
}

export function createDefinePropertyHandler(isShallow: boolean = false) {
  return function defineProperty(
    target: Target,
    key: string | symbol,
    descriptors: PropertyDescriptor
  ): boolean {
    if (!proxyCache.get(target)[ReactiveFlags.IS_ACTIVE]) {
      return Reflect.defineProperty(target, key, descriptors)
    }
  
    let oldValue = target[key]
    let newValue = hasOwn(descriptors, 'value') ?
      descriptors.value :
      (hasOwn(descriptors, 'get') ?
        descriptors.get() :
        undefined);
    if (!isShallow) {
      oldValue = getRaw(oldValue)
      newValue = getRaw(newValue)
    }

    const isAdd = !hasOwn(target, key)
    if (isAdd) {
      dispatch(target, key, ReactiveActionTypes.ADD, undefined, newValue)
    } else if (hasChanged(newValue, oldValue)) {
      dispatch(target, key, ReactiveActionTypes.UPDATE, oldValue, newValue)
    }
  
    return Reflect.defineProperty(target, key, descriptors)
  }
}

export function deleteProperty(target: Target, key: string | symbol): boolean {
  const hasOwnKey = hasOwn(target, key)
  if (proxyCache.get(target)[ReactiveFlags.IS_ACTIVE] && hasOwnKey) {
    dispatch(target, key, ReactiveActionTypes.DELETE, target[key], undefined)
    return Reflect.deleteProperty(target, key)
  }
  return false
}

export function createBaseHandlers({ isShallow }: ReactiveOptions): ProxyHandlers {
  return {
    get: createGetter(isShallow),
    has,
    ownKeys,
    defineProperty: createDefinePropertyHandler(isShallow),
    deleteProperty
  }
}
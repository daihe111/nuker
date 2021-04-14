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
    const rawMethod: Function = Array.prototype[fnName]
    const res = rawMethod.call(this, ...args)
    if (!proxyCache.get(this)[ReactiveFlags.IS_ACTIVE]) {
      return res
    }

    for (let i = 0, len = this.length; i < len; i++) {
      collect(this, i, ReactiveActionTypes.GET)
    }

    if (res === true || res !== -1) {
      return res
    }
    return rawMethod.call(this, ...args.map(arg => getRaw(arg)))
  }
})

// TODO 待 hack Array 方法
([] as const).forEach((fnName: string) => {
  arrayInstrumentations[fnName] = function(...args: any[]) {

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
      return Reflect.get(arrayInstrumentations, key, receiver).bind(target)
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

function has(target: Target, key: string | symbol): boolean {
  const hasKey = Reflect.has(target, key)
  if (proxyCache.get(target)[ReactiveFlags.IS_ACTIVE] && hasKey) {
    collect(target, key, ReactiveActionTypes.HAS)
  }
  return hasKey
}

function ownKeys(target: Target): (string | number | symbol)[] {
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

function defineProperty(
  target: Target,
  key: string | symbol,
  descriptors: PropertyDescriptor
): boolean {
  if (!proxyCache.get(target)[ReactiveFlags.IS_ACTIVE]) {
    return Reflect.defineProperty(target, key, descriptors)
  }

  const oldValue = getRaw(target[key])
  const newValue = getRaw(
    hasOwn(descriptors, 'value') ?
      descriptors.value :
      (hasOwn(descriptors, 'get') ?
        descriptors.get() :
        undefined)
  );
  const isAdd = !hasOwn(target, key)
  if (isAdd) {
    dispatch(target, key, ReactiveActionTypes.ADD, undefined, newValue)
  } else if (hasChanged(newValue, oldValue)) {
    dispatch(target, key, ReactiveActionTypes.UPDATE, oldValue, newValue)
  }

  return Reflect.defineProperty(target, key, descriptors)
}

function deleteProperty(target: Target, key: string | symbol): boolean {
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
    defineProperty,
    deleteProperty
  }
}
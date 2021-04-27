import {
  ReactiveOptions,
  Target,
  reactive,
  ReactiveFlags,
  proxyStatusCache,
  ReactiveProxy,
  proxyCache,
  getRaw
} from "./reactive";
import {
  hasOwn,
  isObject,
  hasChanged,
  isMap,
  isSet
} from "../../share/src";
import {
  collect,
  ReactiveActionTypes,
  dispatch
} from "./effect";
import { reactiveInstrumentations } from './reactiveHelpers'
import {
  createDefinePropertyHandler,
  has,
  ownKeys,
  deleteProperty
} from "./baseHandlers";

export type MapTypes = Map<any, any> | WeakMap<any, any>
export type SetTypes = Set<any> | WeakSet<any>
export type CollectionTypes = MapTypes | SetTypes
export type IterableTypes = Map<any, any> | Set<any>

const collectionInstrumentations: Record<string, Function> = {
  get(key: any, target: MapTypes, isShallow: boolean) {
    // TODO 需要区分 key 和 rawKey 的行为表现
    if (isShallow) {
      collect(target, key, ReactiveActionTypes.GET)
      return target.get(key)
    }

    key = target.has(key) ? key : getRaw(key)
    collect(target, key, ReactiveActionTypes.GET)
    return reactive(target.get(key), { isShallow })
  },
  set(key: any, value: any, target: MapTypes, isShallow: boolean) {
    let oldValue = target.get(key)
    if (isShallow) {
      if (!target.has(key)) {
        dispatch(target, key, ReactiveActionTypes.ADD, oldValue, value)
      } else if (hasChanged(value, oldValue)) {
        dispatch(target, key, ReactiveActionTypes.UPDATE, oldValue, value)
      }
  
      return target.set(key, value)
    }

    oldValue = getRaw(oldValue)
    value = getRaw(value)
    if (target.has(key)) {
      if (hasChanged(value, oldValue)) {
        dispatch(target, key, ReactiveActionTypes.UPDATE, oldValue, value)
        return target.set(key, value)
      }
      return target
    }

    key = getRaw(key)
    if (!target.has(key)) {
      dispatch(target, key, ReactiveActionTypes.ADD, oldValue, value)
    } else if (hasChanged(value, oldValue)) {
      dispatch(target, key, ReactiveActionTypes.UPDATE, oldValue, value)
    }
    return target.set(key, value)
  },
  has(key: any, target: CollectionTypes, isShallow: boolean) {
    let hasKey = target.has(key)
    if (isShallow) {
      if (hasKey) {
        collect(target, key, ReactiveActionTypes.HAS)
      }
      return hasKey
    }

    key = hasKey ? key : getRaw(key)
    hasKey = hasKey || target.has(key)
    if (hasKey) {
      collect(target, key, ReactiveActionTypes.HAS)
      return hasKey
    }
    return hasKey
  },
  add(value: unknown, target: SetTypes, isShallow: boolean) {
    if (isShallow) {
      if (!target.has(value)) {
        dispatch(target, value, ReactiveActionTypes.ADD, undefined, value)
        return target.add(value)
      }
      return target
    }

    if (target.has(value) || target.has(getRaw(value))) {
      return target
    }

    value = getRaw(value)
    dispatch(target, value, ReactiveActionTypes.ADD, undefined, value)
    return target.add(value)
  },
  delete(key: any, target: CollectionTypes, isShallow: boolean) {
    let hasKey = target.has(key)
    if (isShallow) {
      if (hasKey) {
        dispatch(target, key, ReactiveActionTypes.DELETE, target.get(key))
        return target.delete(key)
      }
      return target
    }

    key = hasKey ? key : getRaw(key)
    if (hasKey || target.has(key)) {
      dispatch(target, key, ReactiveActionTypes.DELETE, getRaw(target.get(key)))
      return target.delete(key)
    }
    
    return target
  },
  clear(isShallow: boolean, target: IterableTypes) {
    if (target.size) {
      target.forEach((value: any, key: any) => {
        dispatch(
          target,
          key,
          ReactiveActionTypes.CLEAR,
          isShallow ? value : getRaw(value)
        )
      })
      return target.clear()
    }
    return target
  }
}

export function createCollectionHandlers({ isShallow }: ReactiveOptions) {
  return {
    get: createGetter(isShallow),
    defineProperty: createDefinePropertyHandler(isShallow),
    has,
    ownKeys,
    deleteProperty
  }
}

function createGetter(isShallow: boolean = false) {
  return function get(target: CollectionTypes, key: string | symbol, receiver: object) {
    if (
      proxyCache.get(target as Target) !== receiver ||
      !receiver[ReactiveFlags.IS_ACTIVE]
    ) {
      return Reflect.get(target, key, receiver)
    }

    if (hasOwn(collectionInstrumentations, key) && key in target) {
      return Reflect.get(
        collectionInstrumentations,
        key,
        receiver
      ).bind(null, target, isShallow)
    }

    // todo Collection 数据结构属性拦截

    if (hasOwn(reactiveInstrumentations, key)) {
      return Reflect.get(reactiveInstrumentations, key, receiver).bind(receiver)
    }

    const value = Reflect.get(target, key, receiver)
    collect(target, key, ReactiveActionTypes.GET)
    
    if (!isShallow && isObject(value)) {
      return reactive(value, { isShallow })
    }
    return value
  }
}
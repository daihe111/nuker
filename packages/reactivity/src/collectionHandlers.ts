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

const collectionInstrumentations: Record<string, Function> = {
  get(key: any, isShallow: boolean) {
    // TODO 需要区分 key 和 rawKey 的行为表现
    if (isShallow) {
      collect(this, key, ReactiveActionTypes.GET)
      return this.get(key)
    }

    key = this.has(key) ? key : getRaw(key)
    collect(this, key, ReactiveActionTypes.GET)
    return reactive(this.get(key), { isShallow })
  },
  set(key: any, value: any, isShallow: boolean) {
    let oldValue = this.get(key)
    if (isShallow) {
      if (!this.has(key)) {
        dispatch(this, key, ReactiveActionTypes.ADD, oldValue, value)
      } else if (hasChanged(value, oldValue)) {
        dispatch(this, key, ReactiveActionTypes.UPDATE, oldValue, value)
      }
  
      return this.set(key, value)
    }

    oldValue = getRaw(oldValue)
    value = getRaw(value)
    if (this.has(key)) {
      if (hasChanged(value, oldValue)) {
        dispatch(this, key, ReactiveActionTypes.UPDATE, oldValue, value)
        return this.set(key, value)
      }
      return this
    }

    key = getRaw(key)
    if (!this.has(key)) {
      dispatch(this, key, ReactiveActionTypes.ADD, oldValue, value)
    } else if (hasChanged(value, oldValue)) {
      dispatch(this, key, ReactiveActionTypes.UPDATE, oldValue, value)
    }
    return this.set(key, value)
  },
  has(key: any, isShallow: boolean) {
    let hasKey = this.has(key)
    if (isShallow) {
      if (hasKey) {
        collect(this, key, ReactiveActionTypes.HAS)
      }
      return hasKey
    }

    key = hasKey ? key : getRaw(key)
    hasKey = hasKey || this.has(key)
    if (hasKey) {
      collect(this, key, ReactiveActionTypes.HAS)
      return hasKey
    }
    return hasKey
  },
  add(value: unknown, isShallow: boolean) {
    if (isShallow) {
      if (!this.has(value)) {
        dispatch(this, value, ReactiveActionTypes.ADD, undefined, value)
        return this.add(value)
      }
      return this
    }

    if (this.has(value) || this.has(getRaw(value))) {
      return this
    }

    value = getRaw(value)
    dispatch(this, value, ReactiveActionTypes.ADD, undefined, value)
    return this.add(value)
  },
  delete(key: any, isShallow: boolean) {
    let hasKey = this.has(key)
    if (isShallow) {
      if (hasKey) {
        dispatch(this, key, ReactiveActionTypes.DELETE, this.get(key))
        return this.delete(key)
      }
      return this
    }

    key = hasKey ? key : getRaw(key)
    if (hasKey || this.has(key)) {
      dispatch(this, key, ReactiveActionTypes.DELETE, getRaw(this.get(key)))
      return this.delete(key)
    }
    
    return this
  },
  clear(isShallow: boolean) {
    const items = isMap(this) ? this.keys() : isSet(this) ? this.values() : null
    if (items) {
      items.forEach((item: any) => {
        let oldValue = isMap(this) ? this.get(item) : item
        oldValue = isShallow ? oldValue : getRaw(oldValue)
        dispatch(this, item, ReactiveActionTypes.CLEAR, oldValue)
      })
      return this.clear()
    }
    return this
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
  return function get(target: Target, key: string | symbol, receiver: object) {
    if (
      proxyCache.get(target) !== receiver ||
      !receiver[ReactiveFlags.IS_ACTIVE]
    ) {
      return Reflect.get(target, key, receiver)
    }

    if (hasOwn(collectionInstrumentations, key) && key in target) {
      return Reflect.get(
        collectionInstrumentations,
        key,
        receiver
      ).bind(target, isShallow)
    }

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
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
  hasChanged
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

// const map = new WeakMap()
// const set = new Set()
const collectionInstrumentations: Record<string, Function> = {
  get(key: any, isShallow: boolean) {
    if (key === ReactiveFlags.RAW) {
      return this
    } else if (key === ReactiveFlags.IS_ACTIVE) {
      return proxyStatusCache.get(
        proxyCache.get(this) as ReactiveProxy
      )
    } else if (key === ReactiveFlags.IS_REACTIVE) {
      return true
    } else if (key === ReactiveFlags.IS_SHALLOW) {
      return isShallow
    }

    // TODO 需要区分 key 和 rawKey 的行为表现
    if (isShallow) {
      collect(this, key, ReactiveActionTypes.GET)
      return this.get(key)
    }

    const rawKey = getRaw(key)
    collect(this, rawKey, ReactiveActionTypes.GET)
    return reactive(this.get(key) || this.get(rawKey), { isShallow })
  },
  set(key: any, value: any, isShallow: boolean) {
    let oldValue = this.get(key)
    let newValue = value
    if (!isShallow) {
      // 非 shallow 模式下需要对新旧值的深度 diff，当且仅当数值的原始值发生变化时
      // 才会派发 effects 的批量执行
      oldValue = getRaw(oldValue)
      newValue = getRaw(newValue)
    }

    const isAdd = !this.has(key)
    if (isAdd) {
      dispatch(this, key, ReactiveActionTypes.ADD, oldValue, newValue)
    } else if (hasChanged(newValue, oldValue)) {
      dispatch(this, key, ReactiveActionTypes.UPDATE, oldValue, newValue)
    }

    return this.set(key, value)
  },
  has(key: any, isShallow: boolean) {
    let hasKey = this.has(key)
    if (hasKey) {
      collect(this, key, ReactiveActionTypes.HAS)
      return hasKey
    }

    if (isShallow) {
      return hasKey
    }

    const rawKey = getRaw(key)
    hasKey = this.has(rawKey)
    if (hasKey) {
      collect(this, rawKey, ReactiveActionTypes.HAS)
      return hasKey
    }
    return hasKey
  },
  add(value: unknown, isShallow: boolean) {
    const hasValue = this.has(value)
    if (!hasValue) {
      value = isShallow ? value : getRaw(value)
      dispatch(this, value, ReactiveActionTypes.ADD, undefined, value)
      return this.add(value)
    }
    return this
  },
  delete(key: any, isShallow: boolean) {
    let hasKey = this.has(key)
    if (hasKey) {
      const oldValue = isShallow ? this.get(key) : getRaw(this.get(key))
      dispatch(this, key, ReactiveActionTypes.DELETE, oldValue, undefined)
      return this.delete(key)
    }

    if (isShallow) {
      return this
    }

    const rawKey = getRaw(key)
    hasKey = this.has(rawKey)
    if (hasKey) {
      const oldValue = getRaw(this.get(rawKey))
      dispatch(this, rawKey, ReactiveActionTypes.DELETE, oldValue, undefined)
      return this.delete(rawKey)
    }

    return this
  },
  clear() {

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
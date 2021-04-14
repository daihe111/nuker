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

    const value = this.get(key)
    collect(this, key, ReactiveActionTypes.GET)
    return !isShallow && isObject(value) ? reactive(value, { isShallow }) : value
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

  },
  add(value: unknown, isShallow: boolean) {

  },
  delete(key: any, isShallow: boolean) {

  }
}

export function createCollectionHandlers({ isShallow }: ReactiveOptions) {
  return {
    get: createGetter(isShallow),
    set: createSetter(isShallow)
  }
}

// Set: add delete has      Map: get set has delete
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

function createSetter(isShallow: boolean = false) {

}

function createCollectionInstrumentation(isShallow: boolean = false) {
  
}
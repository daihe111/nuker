export const EMPTY_OBJ: { readonly [key: string]: any } = {}
export const EMPTY_ARR = []

export const MAX_INT = Math.pow(2, 53)

export const NOOP = () => {}

/**
 * Always return false.
 */
export const NO = () => false

export const extend = Object.assign

export const remove = <T>(arr: T[], el: T) => {
  const i = arr.indexOf(el)
  if (i > -1) {
    arr.splice(i, 1)
  }
}

const hasOwnProperty = Object.prototype.hasOwnProperty
export const hasOwn = (
  val: object,
  key: string | symbol
): key is keyof typeof val => hasOwnProperty.call(val, key)

export function deleteProperty(val: object, key: string | number | symbol): void {
  delete val[key]
}

export const isArray = Array.isArray
export const isMap = (val: unknown): val is Map<any, any> =>
  toTypeString(val) === '[object Map]'
export const isSet = (val: unknown): val is Set<any> =>
  toTypeString(val) === '[object Set]'
export const isWeakMap = (val: unknown): val is WeakMap<any, any> =>
  toTypeString(val) === '[object WeakMap]'
export const isWeakSet = (val: unknown): val is WeakSet<any> =>
  toTypeString(val) === '[object WeakSet]'
export const isCollection = (val: unknown): boolean =>
  isMap(val) || isWeakMap(val) || isSet(val) || isWeakSet(val)

export const isDate = (val: unknown): val is Date => val instanceof Date
export const isFunction = (val: unknown): val is Function =>
  typeof val === 'function'
export const isNumber = (val: unknown): val is number => typeof val === 'number'
export const isString = (val: unknown): val is string => typeof val === 'string'
export const isSymbol = (val: unknown): val is symbol => typeof val === 'symbol'
export const isObject = (val: unknown): val is Record<any, any> =>
  val !== null && typeof val === 'object'

export const isPromise = <T = any>(val: unknown): val is Promise<T> => {
  return isObject(val) && isFunction(val.then) && isFunction(val.catch)
}

export const objectToString = Object.prototype.toString
export const toTypeString = (value: unknown): string =>
  objectToString.call(value)
export const getRawType = (value: unknown): string => {
  return objectToString.call(value).slice(8, -1)
}

export const createEmptyObject = (): any => {
  return Object.create(null)
}

// compare whether a value has changed, accounting for NaN.
export const hasChanged = (value: any, oldValue: any): boolean =>
  value !== oldValue && (value === value || oldValue === oldValue)
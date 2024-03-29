import { BaseListNode, ListAccessor } from "./shareTypes"

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
export const isBoolean = (val: unknown): val is boolean => typeof val === 'boolean'
export const isString = (val: unknown): val is string => typeof val === 'string'
export const isSymbol = (val: unknown): val is symbol => typeof val === 'symbol'
export const isObject = (val: unknown): val is Record<any, any> =>
  val !== null && typeof val === 'object'

export const isPromise = <T = any>(val: unknown): val is Promise<T> => {
  return isObject(val) && isFunction(val.then) && isFunction(val.catch)
}

export const isEmptyObject = (object: object): boolean => {
  return !!(Object.keys.call(object) as string[]).length
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

export function genBaseListNode(
  content: any,
  contentKey: string | number | symbol,
  previous?: any,
  next?: any
): BaseListNode {
  return {
    [contentKey]: content,
    previous: previous || null,
    next: next || null
  }
}

/**
 * 创建链表访问器
 * @param first 
 * @param last 
 */
export function createListAccessor<Node extends BaseListNode>(
  first: Node = null,
  last: Node = null
): ListAccessor<Node> {
  return { first, last: last || first }
}

/**
 * 追加元素到链表访问器
 * @param accessor 
 * @param node 
 */
export function addNodeToList<Node extends BaseListNode>(
  accessor: ListAccessor<Node>,
  node: Node
): Node {
  if (accessor.first) {
    accessor.last = accessor.last.next = node
  } else {
    accessor.last = accessor.first = node
  }

  return node
}
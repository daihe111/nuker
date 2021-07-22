export interface BaseListNode {
  // data
  [key: string]: any

  // pointers
  previous: BaseListNode
  next: BaseListNode | null
}
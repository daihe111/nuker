export interface BaseListNode<AdvancedListNode = any> {
  // data
  [key: string]: any

  // pointers
  previous?: AdvancedListNode
  next?: AdvancedListNode
}

export interface ListAccessor<Node> {
  first: Node
  last: Node
}
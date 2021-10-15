import { Chip, ChipChildren } from "./chip";
import { isObject, isFunction, createEmptyObject } from "../../share/src";

export interface OptionComponent {
  install: (props?: object, context?: ComponentInstance) => object
}

export interface ClassComponent {
  
}

export interface FunctionComponent {
  
}

export type Component = OptionComponent | ClassComponent | FunctionComponent

export interface ComponentInstance {
  chip: Chip | null
  Component: Component
  source: object
  render: (source: any) => ChipChildren
  refs: object[] | null
  [key: string]: any
}

export default class NukerComponent {
  constructor(props: unknown[]) {
    this.props = props
  }

  protected props?: unknown[]
}

export function isClassComponent(Component: Component): Component is ClassComponent {
  return false
}

export function createComponentInstance(Component: Component, chipContainer: Chip): ComponentInstance {
  let instance: ComponentInstance = createEmptyObject()
  if (isObject(Component)) {
    // option component
    const install = (Component as OptionComponent).install
    if (isFunction(install)) {
      instance.refs = null
      // 挂载组件数据源
      instance.source = install()
    }
  } else if (isFunction(Component)) {
    // function component
    const renderFn = (Component as Function)()
    instance.render = renderFn
  } else if (isClassComponent(Component)) {
    // class component
    instance = new Component()
  } else {
    // invalid component
  }

  instance.Component = Component
  instance.chip = chipContainer

  return instance
}

export function reuseComponentInstance(instance: ComponentInstance, chipContainer: Chip): ComponentInstance {

}

// 组件初始化需要做的事情：依赖收集
export function initComponent(chip: Chip, instance: ComponentInstance) {
  // 组件子节点树
  const subTree = instance.render(instance)
  chip.subTree = subTree
  const firstChild = subTree[0]
  
}
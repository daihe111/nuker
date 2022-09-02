import { Chip, ChipChildren, ChipPropValue, ChipProps } from "./chip";
import { isFunction, createEmptyObject } from "../../share/src";
import { ListAccessor } from "../../share/src/shareTypes";
import { LifecycleHooks, registerLifecycleHook, LifecycleHookNames } from "./lifecycle";

export const enum ComponentTypes {
  OPTION = '__n_op', // 配置式组件
  CLASS = '__n_cls', // 类式组件
  FUNCTION = '__n_fn' // 函数式组件
}

export interface OptionComponent {
  // flag
  readonly type: ComponentTypes.OPTION

  readonly template?: string // 渲染模板

  readonly children?: ChipChildren // 渲染模板编译出的子代节点

  render?: (source?: any) => ChipChildren // 动态渲染器

  install: (props?: object, context?: ComponentInstance) => object

  // lifecycle hooks
  [LifecycleHooks.INIT]?: Function
  [LifecycleHooks.WILL_MOUNT]?: Function
  [LifecycleHooks.MOUNTED]?: Function
  [LifecycleHooks.WILL_UPDATE]?: Function
  [LifecycleHooks.UPDATED]?: Function
  [LifecycleHooks.WILL_UNMOUNT]?: Function
  [LifecycleHooks.UNMOUNTED]?: Function
}

export interface FunctionComponent {
  (props?: ChipProps): Chip[]
  readonly type: ComponentTypes.FUNCTION
}

export default class NukerComponent  {
  constructor(props: ChipProps) {
    this.props = props
  }

  static readonly type = ComponentTypes.CLASS
  protected props?: ChipProps
  protected source?: any

  // lifecycle hooks
  protected [LifecycleHooks.INIT]: Function
  protected [LifecycleHooks.WILL_MOUNT]: Function
  protected [LifecycleHooks.MOUNTED]: Function
  protected [LifecycleHooks.WILL_UPDATE]: Function
  protected [LifecycleHooks.UPDATED]: Function
  protected [LifecycleHooks.WILL_UNMOUNT]: Function
  protected [LifecycleHooks.UNMOUNTED]: Function

  protected render: () => ChipChildren
}

export type ClassComponent<T = NukerComponent> = T extends NukerComponent ? T : NukerComponent

export type Component = OptionComponent | typeof NukerComponent | FunctionComponent

export interface LifecycleUnit {
  hook: Function
  next: LifecycleUnit
}

export type LifecycleHookList = ListAccessor<LifecycleUnit>

export type ComponentRenderer = (source?: any) => ChipChildren

/**
 * 组件实例抹平了不同形式组件声明之间的数据差异，可通过实例使用相同的 API 
 * 访问到不同形式组件上的数据
 */
export interface ComponentInstance {
  Component: Component // 组件初始配置集
  children?: ChipChildren // 渲染模板编译生成的子代节点
  render?: ComponentRenderer
  refs?: object[] | null

  // data source
  source?: object // 组件自身数据源
  props?: ChipProps // 组件外部属性

  // lifecycle hooks
  [LifecycleHooks.INIT]?: LifecycleHookList
  [LifecycleHooks.WILL_MOUNT]?: LifecycleHookList
  [LifecycleHooks.MOUNTED]?: LifecycleHookList
  [LifecycleHooks.WILL_UPDATE]?: LifecycleHookList
  [LifecycleHooks.UPDATED]?: LifecycleHookList
  [LifecycleHooks.WILL_UNMOUNT]?: LifecycleHookList
  [LifecycleHooks.UNMOUNTED]?: LifecycleHookList

  [key: string]: any
}

/**
 * 根据组件蓝图创建组件实例，旨在为不同形式的组件蓝图创建形式统一的对外代理，
 * 比如，你有可能创建 option、class、function 形式的组件，但是这些形式的
 * 组件之间是有区别的，组件实例此时会作为代理，当需要访问组件内部数据时，组件
 * 实例可对外提供一致的 API，不管你创建的是哪种形式的组件
 * @param Component 
 * @param chipContainer 
 */
export function createComponentInstance(Component: Component, chip: Chip): ComponentInstance {
  let inst: ComponentInstance
  switch (Component.type) {
    case ComponentTypes.OPTION: {
      // option component
      inst = {
        Component,
        children: Component.children,
        render: Component.render,
        source: Component.install(),
        props: chip.props
      }
      // 初始化生命周期
      initLifecycleHooks(inst, Component)
      return inst
    }
    case ComponentTypes.CLASS: {
      // class component
      inst = (new Component(chip.props) as any)
      inst.Component = Component
      initLifecycleHooks(inst)
      return inst
    }
    case ComponentTypes.FUNCTION: {
      // function component
      inst = {
        Component,
        render: (Component as ComponentRenderer)
      }
      return inst
    }
    default: {
      // invalid Component
      return inst
    }
  }
}

/**
 * 初始化组件实例的生命周期，将组件原始生命周期注册到组件实例上
 * @param instance 
 * @param source 
 */
export function initLifecycleHooks(instance: ComponentInstance, source?: object): void {
  source = source || instance
  for (let i = 0; i < LifecycleHookNames.length; i++) {
    const hookName: string = LifecycleHookNames[i]
    registerLifecycleHook(instance, hookName, source[hookName])
  }
}

/**
 * 为组件 chip 创建并挂载子代节点
 * @param chip 
 */
export function mountComponentChildren(chip: Chip): void {
  const instance = (chip.instance as ComponentInstance)
  if (instance.children) {
    chip.children = instance.children
  } else if (isFunction(instance.render)) {
    const { render, source } = instance
    chip.children = render(source)
  } else {
    // do nothing
  }
}

/**
 * 获取组件的子代节点
 * @param chip 
 */
export function getComponentChildren(chip: Chip): ChipChildren {
  const { children, render, source } = chip.instance
  return children ?
    children :
    (render ?
      render(source) :
      null)
}
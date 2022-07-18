import { Chip } from "./chip";
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
  (): Chip
  readonly type: ComponentTypes.FUNCTION
}

export default abstract class NukerComponent {
  constructor(props: unknown[]) {
    this.props = props
  }

  public readonly type = ComponentTypes.CLASS
  protected props?: unknown[]

  // lifecycle hooks
  protected abstract [LifecycleHooks.INIT]: Function
  protected abstract [LifecycleHooks.WILL_MOUNT]: Function
  protected abstract [LifecycleHooks.MOUNTED]: Function
  protected abstract [LifecycleHooks.WILL_UPDATE]: Function
  protected abstract [LifecycleHooks.UPDATED]: Function
  protected abstract [LifecycleHooks.WILL_UNMOUNT]: Function
  protected abstract [LifecycleHooks.UNMOUNTED]: Function
}

export type ClassComponent<T = NukerComponent> = T extends NukerComponent ? T : NukerComponent

export type Component = OptionComponent | ClassComponent | FunctionComponent

export interface LifecycleUnit {
  hook: Function
  next: LifecycleUnit
}

export type LifecycleHookList = ListAccessor<LifecycleUnit>

export interface ComponentInstance {
  chip: Chip | null
  Component: Component
  render: (source?: any) => Chip[]
  refs: object[] | null
  [key: string]: any

  // data source
  source: object // 组件自身数据源
  props?: object // 组件接受的外部属性

  // lifecycle hooks
  [LifecycleHooks.INIT]: LifecycleHookList
  [LifecycleHooks.WILL_MOUNT]: LifecycleHookList
  [LifecycleHooks.MOUNTED]: LifecycleHookList
  [LifecycleHooks.WILL_UPDATE]: LifecycleHookList
  [LifecycleHooks.UPDATED]: LifecycleHookList
  [LifecycleHooks.WILL_UNMOUNT]: LifecycleHookList
  [LifecycleHooks.UNMOUNTED]: LifecycleHookList
}

/**
 * 根据组件蓝图创建组件实例，旨在为不同形式的组件蓝图创建形式统一的对外代理，
 * 比如，你有可能创建 option、class、function 形式的组件，但是这些形式的
 * 组件之间是有区别的，组件实例此时会作为代理，当需要访问组件内部数据时，组件
 * 实例可对外提供一致的 API，不管你创建的是哪种形式的组件
 * @param Component 
 * @param chipContainer 
 */
export function createComponentInstance(Component: Component, chipContainer: Chip): ComponentInstance {
  let instance: ComponentInstance = createEmptyObject()
  switch (Component.type) {
    case ComponentTypes.OPTION: {
      // option component
      const install = Component.install
      if (isFunction(install)) {
        // 挂载组件数据源
        instance.source = install()
        initLifecycleHooks(instance, Component)
      }
      break
    }
    case ComponentTypes.CLASS: {
      // class component
      instance = new Component()
      initLifecycleHooks(instance)
      break
    }
    case ComponentTypes.FUNCTION: {
      // function component
      instance.render = Component
      break
    }
    default: {
      // invalid Component
      break
    }
  }

  instance.Component = Component
  instance.chip = chipContainer

  return instance
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

export function reuseComponentInstance(instance: ComponentInstance, chipContainer: Chip): ComponentInstance {

}
import { ComponentInstance, LifecycleUnit } from "./component";
import { ListAccessor } from "../../share/src/shareTypes";
import { disableCollecting, enableCollecting } from "../../reactivity/src/effect";
import { currentRenderingInstance } from './workRender'
import { isFunction } from "../../share/src";
import { ChipRoot } from "./chip";

export const enum HookInvokingStrategies {
  ON_IDLE = 0, // 生命周期在空闲时触发 (默认策略)
  IMMEDIATELY = 1 // 生命周期在组件自身执行完指定阶段的工作后立即触发
}

export const enum LifecycleHooks {
  INIT = '__n_i',
  WILL_MOUNT = '__n_wm',
  MOUNTED = '__n_m',
  WILL_UPDATE = '__n_wu',
  UPDATED = '__n_u',
  WILL_UNMOUNT = '__n_wum',
  UNMOUNTED = '__n_um',
  CATCH = '__n_c'
}

export const LifecycleHookNames: string[] = [
  LifecycleHooks.INIT,
  LifecycleHooks.UNMOUNTED,
  LifecycleHooks.MOUNTED,
  LifecycleHooks.WILL_UPDATE,
  LifecycleHooks.UPDATED,
  LifecycleHooks.WILL_UNMOUNT,
  LifecycleHooks.UNMOUNTED,
  LifecycleHooks.CATCH
]

/**
 * 将指定的生命周期注册到组件实例上
 * @param instance 
 * @param hookName 
 * @param hook 
 * @param antecedent 
 */
export function registerLifecycleHook(
  instance: ComponentInstance | ChipRoot,
  hookName: string,
  hook: Function | LifecycleUnit,
  antecedent?: boolean
): void {
  if (isFunction(hook)) {
    
  }
  const hooks: ListAccessor<LifecycleUnit> = instance[hookName]
  const hookUnit: LifecycleUnit = isFunction(hook) ? {
    hook: (...args: any[]) => {
      disableCollecting()
      try {
        hook(...args)
      } catch (e) {
        throw e
      }
      enableCollecting()
    },
    next: null
  } : hook
  if (hooks) {
    if (antecedent) {
      // 生命周期需要预先执行，因此需要插到队头
      hookUnit.next = hooks.first
      hooks.first = hookUnit
    } else {
      hooks.last = hooks.last.next = hookUnit
    }
  } else {
    instance[hookName] = {
      first: hookUnit,
      last: hookUnit
    }
  }
}

export function init(
  hook: Function,
  instance: ComponentInstance = currentRenderingInstance
): void {
  registerLifecycleHook(instance, LifecycleHooks.INIT, hook)
}

export function willMount(
  hook: Function,
  instance: ComponentInstance = currentRenderingInstance
): void {
  registerLifecycleHook(instance, LifecycleHooks.WILL_MOUNT, hook)
}

export function mounted(
  hook: Function,
  instance: ComponentInstance = currentRenderingInstance
): void {
  registerLifecycleHook(instance, LifecycleHooks.MOUNTED, hook)
}

export function willUpdate(
  hook: Function,
  instance: ComponentInstance = currentRenderingInstance
): void {
  registerLifecycleHook(instance, LifecycleHooks.WILL_UPDATE, hook)
}

export function updated(
  hook: Function,
  instance: ComponentInstance = currentRenderingInstance
): void {
  registerLifecycleHook(instance, LifecycleHooks.UPDATED, hook)
}

export function willUnmount(
  hook: Function,
  instance: ComponentInstance = currentRenderingInstance
): void {
  registerLifecycleHook(instance, LifecycleHooks.WILL_UNMOUNT, hook)
}

export function unmounted(
  hook: Function,
  instance: ComponentInstance = currentRenderingInstance
): void {
  registerLifecycleHook(instance, LifecycleHooks.UNMOUNTED, hook)
}

export function invokeLifecycle(
  hookName: string,
  instance: ComponentInstance | ChipRoot = currentRenderingInstance
): void {
  const hooks: ListAccessor<LifecycleUnit> = instance[hookName]
  let currentUnit: LifecycleUnit = hooks.first
  while (currentUnit !== null) {
    currentUnit.hook()
    currentUnit = currentUnit.next
  }
}
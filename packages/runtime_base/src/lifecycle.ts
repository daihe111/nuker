import { ComponentInstance, LifecycleUnit } from "./component";
import { ListAccessor } from "../../share/src/shareTypes";
import { disableCollecting, enableCollecting } from "../../reactivity/src/effect";
import { currentRenderingInstance } from './workRender'

export const LifecycleHooks = {
  INIT: '__n_i',
  WILL_MOUNT: '__n_wm',
  MOUNTED: '__n_m',
  WILL_UPDATE: '__n_wu',
  UPDATED: '__n_u',
  WILL_UNMOUNT: '__n_wum',
  UNMOUNTED: '__n_um',
  CATCH: '__n_c'
}

/**
 * 将指定的生命周期注册到组件实例上
 * @param instance 
 * @param hookName 
 * @param hook 
 * @param antecedent 
 */
export function registerLifecycleHook(
  instance: ComponentInstance,
  hookName: string,
  hook: Function,
  antecedent?: boolean
): void {
  const hooks: ListAccessor<LifecycleUnit> = instance[hookName]
  const hookUnit: LifecycleUnit = {
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
  }
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
  instance: ComponentInstance = currentRenderingInstance
): void {
  const hooks: ListAccessor<LifecycleUnit> = instance[hookName]
  let currentUnit: LifecycleUnit = hooks.first
  while (currentUnit !== null) {
    currentUnit.hook()
    currentUnit = currentUnit.next
  }
}
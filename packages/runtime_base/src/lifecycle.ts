import { ComponentInstance, LifecycleUnit } from "./component";
import { ListAccessor } from "../../share/src/shareTypes";
import { disableCollecting, enableCollecting } from "../../reactivity/src/effect";

export const LifecycleHooks = {
  INIT: '__n_i',
  WILL_MOUNT: '__n_wm',
  MOUNTED: '__n_m',
  WILL_UPDATE: '__n_wu',
  UPDATED: '__n_u',
  WILL_UNMOUNT: '__n_wum',
  UNMOUNTED: '__n_um'
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

export function invokeLifecycle(key: string, instance: ComponentInstance): void {
  instance
}
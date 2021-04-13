import {
  proxyStatusCache,
  ReactiveProxyStatus
} from './reactive'
import { createEmptyObject } from '../../share/src'

export const ReactiveHelpers: Record<string, string> = {
  ACTIVE: 'active',
  DEACTIVE: 'deactive'
}

export const ReactiveHelperToStatusMap: Record<string, number> = {
  [ReactiveHelpers.ACTIVE]: ReactiveProxyStatus.ACTIVE,
  [ReactiveHelpers.DEACTIVE]: ReactiveProxyStatus.DEACTIVE
}

export const reactiveInstrumentations: Record<string, Function> = createEmptyObject()

([ReactiveHelpers.ACTIVE, ReactiveHelpers.DEACTIVE] as const).forEach((fnName: string) => {
  reactiveInstrumentations[fnName] = function() {
    proxyStatusCache.set(this, ReactiveHelperToStatusMap[fnName])
  }
})
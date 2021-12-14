import { Chip, ChipChildren } from "./chip";

export type VirtualChipRender = (source?: any, sourceKey?: any) => ChipChildren

export interface VirtualOptions {
  source: Array<object> | object
  sourceKey?: Array<unknown> | unknown
  render: VirtualChipRender
}

export interface VirtualInstance {
  chip: Chip | null
  source: Array<object> | object
  sourceKey?: Array<unknown> | unknown
  render: VirtualChipRender
  refs: object[] | null
  [key: string]: any
}

export function createVirtualChipInstance(chip: Chip): VirtualInstance {
  const { source, sourceKey, render } = (chip.tag as VirtualOptions)
  // TODO instance 信息待补充
  return {
    chip,
    source,
    sourceKey,
    render,
    refs: null
  }
}
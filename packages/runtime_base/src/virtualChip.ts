import { Chip, ChipChildren } from "./chip";
import { ChildrenRenderer } from "./workRender";

export interface VirtualOptions {
  source: Array<object> | object
  sourceKey?: Array<unknown> | unknown
  render: (source: any, sourceKey: any) => ChipChildren
}

export interface VirtualInstance {
  chip: Chip | null
  source: Array<object> | object
  sourceKey?: Array<unknown> | unknown
  render: (source: any, sourceKey: any) => ChipChildren
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
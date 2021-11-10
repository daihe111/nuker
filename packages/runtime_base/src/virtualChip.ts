import { Chip, ChipChildren } from "./chip";
import { ChildrenRenderer } from "./workRender";

export interface VirtualOptions {
  source: any
  sourceFlag: number
  render: (source?: any) => ChipChildren
}

export interface VirtualInstance {
  chip: Chip | null
  source: object
  sourceFlag: number
  render: (source?: any) => ChipChildren
  refs: object[] | null
  [key: string]: any
}

export function createVirtualChipInstance(chip: Chip): VirtualInstance {
  const { source, sourceFlag, render } = (chip.tag as VirtualOptions)
  // TODO instance 信息待补充
  return {
    chip,
    source,
    sourceFlag,
    render,
    refs: null
  }
}
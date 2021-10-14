import { Chip, ChipChildren } from "./chip";
import { ChildrenRenderer } from "./workRender";

export interface VirtualInstance {
  chip: Chip | null
  source: object
  render: (source: any) => ChipChildren
  refs: object[] | null
  [key: string]: any
}

export function createVirtualChipInstance(chip: Chip): VirtualInstance {
  const { source, render } = (chip.children as ChildrenRenderer)
  // TODO instance 信息待补充
  return {
    chip,
    source,
    render,
    refs: null
  }
}
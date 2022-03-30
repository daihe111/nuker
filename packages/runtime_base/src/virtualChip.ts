import { Chip, ChipChildren, DynamicValueGetter, ChipTypes } from "./chip";

export type VirtualChipRender = (source?: any, sourceKey?: any) => ChipChildren

export interface VirtualOptions {
  sourceGetter: DynamicValueGetter
  render: VirtualChipRender
}

export interface VirtualInstance {
  chip: Chip | null
  sourceGetter: DynamicValueGetter
  render: VirtualChipRender
  refs: object[] | null
  [key: string]: any
}

export function createVirtualChipInstance(chip: Chip): VirtualInstance {
  const { sourceGetter, render } = (chip.tag as VirtualOptions)
  // TODO instance 信息待补充
  return {
    chip,
    sourceGetter,
    render,
    refs: null
  }
}

/**
 * 校验 chip 节点是否为虚拟容器节点的根节点
 * @param chip 
 */
export function isRootOfVirtualChip(chip: Chip): boolean {
  const parent: Chip = chip.parent
  return (parent.chipType === ChipTypes.FRAGMENT || parent.chipType === ChipTypes.CONDITION)
}
import { Chip, ChipChildren, DynamicValueGetter, ChipTypes } from "./chip";

export type VirtualChipRender = (source?: any, sourceKey?: any) => Chip | ChipChildren

export interface VirtualOptions {
  sourceGetter: DynamicValueGetter
  render: VirtualChipRender
}

export interface VirtualInstance {
  chip: Chip | null
  sourceGetter: DynamicValueGetter
  // 虚拟容器节点对应的子代内容渲染器
  // 注意: 条件渲染器生成的每个节点块都要有独立的 key，因为条件节点为完全
  // 不可预测结构，因此当条件值发生变化后，reconcile 阶段由于新旧节点块
  // 的 key 不相同，因此新节点块会完全替换掉旧节点块
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
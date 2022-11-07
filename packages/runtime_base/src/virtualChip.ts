import { Chip, ChipChildren, DynamicValueGetter, ChipTypes } from "./chip";

export type VirtualChipRender = (source?: any, sourceKey?: any) => ChipChildren | Chip

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
 * 获取虚拟容器节点的子代节点
 * @param chip 
 */
export function getVirtualChildren(chip: Chip): ChipChildren  {
  return (chip.instance as VirtualInstance).render()
}
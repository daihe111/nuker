import { Chip, ChipRoot } from "./chip";
import { genBaseListNode, isArray, isNumber, isString, isObject } from "../../share/src";
import { VNode, VNodeChildren, VNodeTypes } from "./vnode";
import { registerJob } from "./scheduler";
import { ComponentInstance, Component, createComponentInstance, reuseComponentInstance } from "./component";

const dynamicChipKey = Symbol()
// 包含动态内容的 chip 链表
const dynamicChipList = genBaseListNode(null, dynamicChipKey)
// 正在进行中的 chip 节点
let ongoingChip = null

// update types: 
// unstable dom (if-structure, for-structure)
// stable dom props
// stable children (text node)

// source change -> trigger effect -> gen update payload
// -> update payload: { type: 'updateProps', elm, content: { prop1, prop2 }, next: null }
// the update payload struct a update list
// update types: updateProps, remove, append, replace, move

// tasks: reconcile, user event (CPU-scheduled)
// update payload: run sync

// 单个任务要做的工作：
// 首次渲染：每个节点生成对应的 update payload，依赖收集
// 更新：包含 update payload 生成逻辑的 effect，该 effect
// 作为当前正在处理的任务节点

// 首次渲染：有向图 chip 节点遍历，产生的任务：渲染准备、update payload
// 更新：渲染信息更新 (instance, data source...)、update payload (保证由子到父倒序执行，离屏渲染)

// 触发 chip list 的遍历执行
export function workChips(chipRoot: ChipRoot) {
  const hasMounted: boolean = chipRoot.hasMounted
  if (!hasMounted) {
    // first mount
    traverseChipTree(chipRoot)
  } else {
    // update

  }
}

// 需进行 dive-swim-bubble 后序遍历模型，保证 effect 的先子后父进行挂载
// 便于 commit 阶段实用内存进行离屏渲染
export function traverseChipTree(parent: Chip, children?: VNodeChildren): void {
  ongoingChip = parent

  // dive
  while (ongoingChip !== null) {
    // 当前 chip 产生的 CPU-bound task，将其注册进 scheduler
    registerJob(() => {
      prepareRenderWorkForChip(ongoingChip)
    })

    let firstChild = ongoingChip.firstChild
    if (firstChild === null) {
      firstChild = parent.firstChild = createChipFromVNode(children[0])
      if (firstChild === null) {
        // 叶子节点，完成叶子节点任务，结束 dive，开始 swim
        completeChip(ongoingChip)
        break
      }
    }
    ongoingChip = firstChild.firstChild
  }
}

// 为当前 chip 提供可供渲染用的相关准备工作
export function prepareRenderWorkForChip(chip: Chip) {
  switch (chip.unitType) {
    case VNodeTypes.CUSTOM_COMPONENT:
      handleComponentChip()
  }
}

export function completeChip(chip: Chip) {

}

export function createChipFromVNode(vnode: VNode): Chip | null {
  return
}

// TODO 如何收集动态节点？数据更新时如何生成新的动态节点链表？
// 是否可以避开组件粒度全量子树的 re-create ？

export function handleComponentChip(chip: Chip): void {
  const instance = chip.instance
  if (instance === null) {
    // first mount 创建组件类型 chip 对应的 instance
    chip.instance = createComponentInstance((chip.tag as Component), chip)
    // 
  } else {
    // 复用已经存在的 instance
    chip.instance = reuseComponentInstance(instance, chip)
  }
}
/**
 * Compile flags are optimization hints generated by the compiler.
 * when a block with dynamicChildren is encountered during diff, the algorithm
 * enters "optimized mode". In this mode, we know that the vdom is produced by
 * a render function generated by the compiler, so the algorithm only needs to
 * handle updates explicitly marked by these Compile flags.
 *
 * Compile flags can be combined using the | bitwise operator and can be checked
 * using the & operator, e.g.
 *
 * ```js
 * const flag = TEXT | CLASS
 * if (flag & TEXT) { ... }
 * ```
 *
 * Check the `patchElement` function in '../../runtime-core/src/renderer.ts' to see how the
 * flags are handled during diff.
 */
export const enum CompileFlags {
  /**
   * Indicates an element with dynamic textContent (children fast path)
   */
  TEXT = 1,

  /**
   * Indicates an element with dynamic class binding.
   */
  CLASS = 1 << 1,

  /**
   * Indicates an element with dynamic style
   * The compiler pre-compiles static string styles into static objects
   * + detects and hoists inline static objects
   * e.g. style="color: red" and :style="{ color: 'red' }" both get hoisted as
   *   const style = { color: 'red' }
   *   render() { return e('div', { style }) }
   */
  STYLE = 1 << 2,

  /**
   * Indicates an element that has non-class/style dynamic props.
   * Can also be on a component that has any dynamic props (includes
   * class/style). when this flag is present, the vnode also has a dynamicProps
   * array that contains the keys of the props that may change so the runtime
   * can diff them faster (without having to worry about removed props)
   */
  PROPS = 1 << 3,

  /**
   * Indicates an element with props with dynamic keys. When keys change, a full
   * diff is always needed to remove the old key. This flag is mutually
   * exclusive with CLASS, STYLE and PROPS.
   */
  FULL_PROPS = 1 << 4,

  /**
   * Indicates an element with event listeners (which need to be attached
   * during hydration)
   */
  HYDRATE_EVENTS = 1 << 5,

  /**
   * Indicates a fragment whose children order doesn't change.
   */
  STABLE_FRAGMENT = 1 << 6,

  /**
   * Indicates a fragment with keyed or partially keyed children
   */
  KEYED_FRAGMENT = 1 << 7,

  /**
   * Indicates a fragment with unkeyed children.
   */
  UNKEYED_FRAGMENT = 1 << 8,

  /**
   * Indicates an element that only needs non-props patching, e.g. ref or
   * directives (onVnodeXXX hooks). since every patched vnode checks for refs
   * and onVnodeXXX hooks, it simply marks the vnode so that a parent block
   * will track it.
   */
  NEED_PATCH = 1 << 9,

  /**
   * Indicates a component with dynamic slots (e.g. slot that references a v-for
   * iterated value, or dynamic slot names).
   * Components with this flag are always force updated.
   */
  DYNAMIC_SLOTS = 1 << 10,

  /**
   * Indicates a fragment that was created only because the user has placed
   * comments at the root level of a template. This is a dev-only flag since
   * comments are stripped in production.
   */
  DEV_ROOT_FRAGMENT = 1 << 11,

  /**
   * 表示节点本身是静态的
   */

  STATIC = 1 << 12,

  /**
   * 节点及其子代节点是完全静态的
   */
  COMPLETE_STATIC = 1 << 13,
  
  /**
   * 协调单元
   * 在协调过程中通过检测节点最近的协调单元来决定改节点的协调是否可跳过
   */
  RECONCILE_CELL = 1 << 14,

  /**
   * 子代结构完全不可预测的 chip，如条件节点，你完全无法预测不同条件下会渲染出什么样的子代结构，
   * 由拥有该标记的 chip 产生的 reconcile 中，全部子代节点均不能跳过 reconcile
   */
  UNPREDICTABLE = 1 << 15,

  /**
   * 子代结构完全可预测的 chip，持有该标记的 chip 直接更新 dom 属性，不会触发 reconcile
   */
  PREDICTABLE = 1 << 16,

  /**
   * 子代节点的结构部分可预测，如可迭代节点的单元渲染模板
   */
  PARTIAL_PREDICTABLE = 1 << 17,

  /**
   * 渲染协调块
   * 可以作为一个渲染协调块的渲染区域如下:
   * 1. 条件、可迭代节点对应的虚拟容器节点 2. 其他具有独立上下文环境的特殊节点
   * 渲染协调块拥有自己的渲染数据与渲染器，当上下文的数据发生变化时，会发起以当前
   * 块为基准的新老节点树协调行为
   */
  RECONCILE_BLOCK = 1 << 18,

  /**
   * Indicates a hoisted static vnode. This is a hint for hydration to skip
   * the entire sub tree since static content never needs to be updated.
   */
  HOISTED = -1,
  /**
   * A special flag that indicates that the diffing algorithm should bail out
   * of optimized mode. For example, on block fragments created by renderSlot()
   * when encountering non-compiler generated slots (i.e. manually written
   * render functions, which should always be fully diffed)
   * OR manually cloneVNodes
   */
  BAIL = -2
}

/**
 * dev only flag -> name mapping
 */
export const CompileFlagNames = {
  [CompileFlags.TEXT]: `TEXT`,
  [CompileFlags.CLASS]: `CLASS`,
  [CompileFlags.STYLE]: `STYLE`,
  [CompileFlags.PROPS]: `PROPS`,
  [CompileFlags.FULL_PROPS]: `FULL_PROPS`,
  [CompileFlags.HYDRATE_EVENTS]: `HYDRATE_EVENTS`,
  [CompileFlags.STABLE_FRAGMENT]: `STABLE_FRAGMENT`,
  [CompileFlags.KEYED_FRAGMENT]: `KEYED_FRAGMENT`,
  [CompileFlags.UNKEYED_FRAGMENT]: `UNKEYED_FRAGMENT`,
  [CompileFlags.NEED_PATCH]: `NEED_PATCH`,
  [CompileFlags.DYNAMIC_SLOTS]: `DYNAMIC_SLOTS`,
  [CompileFlags.DEV_ROOT_FRAGMENT]: `DEV_ROOT_FRAGMENT`,
  [CompileFlags.HOISTED]: `HOISTED`,
  [CompileFlags.BAIL]: `BAIL`
}

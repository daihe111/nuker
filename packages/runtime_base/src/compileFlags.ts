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
   * SPECIAL FLAGS -------------------------------------------------------------
   * Special flags are negative integers. They are never matched against using
   * bitwise operators (bitwise matching should only happen in branches where
   * patchFlag > 0), and are mutually exclusive. When checking for a special
   * flag, simply check patchFlag === FLAG.
   */

  STATIC = 1 << 12,

  /**
   * 渲染块 (block) flags
   * 可以作为一个渲染块的渲染区域如下:
   * 1. 组件 2. 条件、可迭代节点 3. 其他具有独立上下文环境的特殊节点
   */

  /**
   * 子代结构不可预测的 chip，如条件节点，你完全无法预测不同条件下会渲染出什么样的子代结构
   */
  UNPREDICTABLE = 1 << 13,

  /**
   * 子代结构不完全可预测的 chip
   * 如可迭代节点就是部分可预测的，其整体结构可变，但是每一个 item 的渲染结构是相同的
   */
  INCOMPLETE_PREDICTABLE = 1 << 14,

  /**
   * 自带结构完全可预测的 chip
   */
  PREDICTABLE = 1 << 15,

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

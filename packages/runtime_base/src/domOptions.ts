import { createMap } from '../../share/src/utils'

export const svgNS = 'http://www.w3.org/2000/svg'

const doc = (typeof document !== 'undefined' ? document : null) as Document

const staticTemplateCache = new Map<string, DocumentFragment>()

export function isReservedTag(tag) {
  return isHTMLTag(tag) || isSVGTag(tag);
}

export const isHTMLTag = createMap(
  'html/body/base/head/link/meta/style/title/' +
  'address/article/aside/footer/header/h1/h2/h3/h4/h5/h6/hgroup/nav/section/' +
  'div/dd/dl/dt/figcaption/figure/picture/hr/img/li/main/ol/p/pre/ul/' +
  'a/b/abbr/bdi/bdo/br/cite/code/data/dfn/em/i/kbd/mark/q/rp/rt/rtc/ruby/' +
  's/samp/small/span/strong/sub/sup/time/u/var/wbr/area/audio/map/track/video/' +
  'embed/object/param/source/canvas/script/noscript/del/ins/' +
  'caption/col/colgroup/table/thead/tbody/td/th/tr/' +
  'button/datalist/fieldset/form/input/label/legend/meter/optgroup/option/' +
  'output/progress/select/textarea/' +
  'details/dialog/menu/menuitem/summary/' +
  'content/element/shadow/template/blockquote/iframe/tfoot'
);

export const isSVGTag = createMap(
  'svg/animate/circle/clippath/cursor/defs/desc/ellipse/filter/font-face/' +
  'foreignObject/g/glyph/image/line/marker/mask/missing-glyph/path/pattern/' +
  'polygon/polyline/rect/switch/symbol/text/textpath/tspan/use/view'
);

// dom 操作对外接口工具集
export const domOptions = {
  getElementById(id: string): Element {
    return document.getElementById(id)
  },

  insert: (child, parent, anchor) => {
    parent.insertBefore(child, anchor || null)
  },

  appendChild: (child, parent) => {
    parent.appendChild(child)
  },

  remove: (child, parent) => {
    parent = parent || child.parentNode
    if (parent) {
      parent.removeChild(child)
    }
  },

  createElement: (tag, isSVG, is, props?: Record<string, string>): Element => {
    const el = isSVG
      ? doc.createElementNS(svgNS, tag)
      : doc.createElement(tag, is ? { is } : undefined)

    if (tag === 'select' && props && props.multiple != null) {
      ;(el as HTMLSelectElement).setAttribute('multiple', props.multiple)
    }

    return el
  },

  createText: text => doc.createTextNode(text),

  createComment: text => doc.createComment(text),

  setAttribute: (node, key, value) => {
    node.setAttribute(key, value)
  },

  removeAttribute: (node, key) => {
    node.removeAttribute(key)
  },

  setText: (node, text) => {
    node.nodeValue = text
  },

  setElementText: (el, text) => {
    el.textContent = text
  },

  parentNode: node => node.parentNode as Element | null,

  nextSibling: node => node.nextSibling,

  querySelector: selector => doc.querySelector(selector),

  setScopeId(el, id) {
    el.setAttribute(id, '')
  },

  cloneNode(el) {
    return el.cloneNode(true)
  },

  // __UNSAFE__
  // Reason: innerHTML.
  // Static content here can only come from compiled templates.
  // As long as the user only uses trusted templates, this is safe.
  insertStaticContent(content, parent, anchor, isSVG) {
    // <parent> before | first ... last | anchor </parent>
    const before = anchor ? anchor.previousSibling : parent.lastChild
    let template = staticTemplateCache.get(content)
    if (!template) {
      const t = doc.createElement('template')
      t.innerHTML = isSVG ? `<svg>${content}</svg>` : content
      template = t.content
      if (isSVG) {
        // remove outer svg wrapper
        const wrapper = template.firstChild!
        while (wrapper.firstChild) {
          template.appendChild(wrapper.firstChild)
        }
        template.removeChild(wrapper)
      }
      staticTemplateCache.set(content, template)
    }
    parent.insertBefore(template.cloneNode(true), anchor)
    return [
      // first
      before ? before.nextSibling! : parent.firstChild!,
      // last
      anchor ? anchor.previousSibling! : parent.lastChild!
    ]
  }
}
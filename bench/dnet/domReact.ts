/**
 * The slice of React the in-game dnet views use (createElement with plain tags, style objects,
 * keys and nested child arrays), building DOM nodes directly.
 *
 * In the game those views get React from `window.React` (getReact() in src/libraries/scriptLogUi.ts).
 * A bench page installs this instead, so the same view code draws there without a React dependency:
 *
 *   installDomReact()
 *   container.replaceChildren(buildLabyrinthMapReact(snapshot, ctx) as unknown as Node)
 */

const SVG_NS = "http://www.w3.org/2000/svg"
const SVG_TAGS = new Set(["svg", "polyline", "line", "path", "circle", "rect", "g", "text"])

/** Style properties React leaves as plain numbers; every other number gets "px". */
const UNITLESS = new Set([
  "opacity",
  "zIndex",
  "fontWeight",
  "lineHeight",
  "flex",
  "flexGrow",
  "flexShrink",
  "order",
  "zoom",
])

/** SVG attributes React spells in camelCase. */
const SVG_ATTRIBUTES: Record<string, string> = {
  strokeWidth: "stroke-width",
  strokeLinecap: "stroke-linecap",
  strokeLinejoin: "stroke-linejoin",
  strokeDasharray: "stroke-dasharray",
  fillOpacity: "fill-opacity",
  strokeOpacity: "stroke-opacity",
}

type Child = Node | string | number | boolean | null | undefined | Child[]

function append(parent: Node, child: Child): void {
  if (child === null || child === undefined || typeof child === "boolean") return
  if (Array.isArray(child)) {
    for (const item of child) append(parent, item)
    return
  }
  parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)))
}

function createElement(type: unknown, props: Record<string, unknown> | null, ...children: Child[]): Node {
  if (typeof type !== "string") throw new Error("domReact renders plain tags only, not components")
  const svg = SVG_TAGS.has(type)
  const node = svg ? document.createElementNS(SVG_NS, type) : document.createElement(type)
  for (const [name, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false || name === "key" || name === "ref") continue
    if (name === "children") {
      append(node, value as Child)
    } else if (name === "style") {
      const style = (node as HTMLElement).style as unknown as Record<string, string>
      for (const [property, raw] of Object.entries(value as Record<string, unknown>)) {
        if (raw === null || raw === undefined) continue
        style[property] = typeof raw === "number" && !UNITLESS.has(property) ? `${raw}px` : String(raw)
      }
    } else if (name === "className") {
      node.setAttribute("class", String(value))
    } else if (/^on[A-Z]/.test(name) && typeof value === "function") {
      node.addEventListener(name.slice(2).toLowerCase(), value as EventListener)
    } else {
      node.setAttribute(svg ? (SVG_ATTRIBUTES[name] ?? name) : name === "colSpan" ? "colspan" : name, String(value))
    }
  }
  for (const child of children) append(node, child)
  return node
}

/** Make getReact() in the shared view code return this renderer. Hooks are not provided. */
export function installDomReact(): void {
  const target = globalThis as unknown as { React?: unknown }
  if (target.React === undefined) target.React = { createElement }
}

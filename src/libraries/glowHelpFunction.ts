const glowClass = "glow"
const doc: Document = eval("document")
const win: Window = eval("window")
const glowSize = 20

export function makeDropShadow(element: HTMLElement): SVGFEDropShadowElement {
  let color = getComputedStyle(element).fill
  const isAchievement = element.style.filter.includes("hue-rotate")
  if (isAchievement) {
    const heading = element.parentElement?.nextSibling
      ?.firstChild as HTMLElement
    color = getComputedStyle(heading).color
  }
  const intensity = calculateGlowIntensity(color)
  const opacity = intensity
  const feDropShadow = doc.createElementNS(
    "http://www.w3.org/2000/svg",
    "feDropShadow"
  )
  feDropShadow.setAttribute("dx", "0")
  feDropShadow.setAttribute("dy", "0")
  feDropShadow.setAttribute("stdDeviation", `${glowSize / 2}`)
  feDropShadow.setAttribute("flood-color", "white")
  feDropShadow.setAttribute("flood-opacity", String(opacity))
  return feDropShadow
}

export function addDropShadowFilter(element: HTMLElement): string {
  const shadow = makeDropShadow(element)

  const shadowHash = generateHash(shadow.outerHTML)

  const filterElement = doc.body.querySelector(
    `body > svg > #glow-filter${shadowHash}`
  )
  if (!filterElement) {
    const filter = doc.createElementNS("http://www.w3.org/2000/svg", "filter")
    filter.setAttribute("id", `glow-filter${shadowHash}`)
    filter.appendChild(shadow)
    const body = doc.body
    let svg = body.querySelector("body > svg")

    if (!svg) {
      svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg")
      // Apply CSS styles to the <svg> element
      addStyle(
        svg as HTMLElement,
        `
            position: absolute;
            width: 0;
            height: 0;
            overflow: hidden;
            pointer-events: none;
            `
      )
      body.insertBefore(svg, body.firstChild)
    }
    svg.appendChild(filter)
  }

  return shadowHash
}

export function calculateSvgStyle(element: HTMLElement): string {
  const shadowHash = addDropShadowFilter(element)
  const computedStyle = getComputedStyle(element)

  const originalMarginTop = parseInt(computedStyle.marginTop.replace("px", ""))
  const originalMarginRight = parseInt(
    computedStyle.marginRight.replace("px", "")
  )
  const originalMarginBottom = parseInt(
    computedStyle.marginBottom.replace("px", "")
  )
  const originalMarginLeft = parseInt(
    computedStyle.marginLeft.replace("px", "")
  )

  const originalPaddingTop = parseInt(
    computedStyle.paddingTop.replace("px", "")
  )
  const originalPaddingRight = parseInt(
    computedStyle.paddingRight.replace("px", "")
  )
  const originalPaddingBottom = parseInt(
    computedStyle.paddingBottom.replace("px", "")
  )
  const originalPaddingLeft = parseInt(
    computedStyle.paddingLeft.replace("px", "")
  )
  const style = `
  filter: ${
    element.style.filter ?? ""
  } url(#glow-filter${shadowHash}) !important;
  margin-top: ${originalMarginTop - glowSize}px !important;
  margin-right: ${originalMarginRight - glowSize}px !important;
  margin-bottom: ${originalMarginBottom - glowSize}px !important;
  margin-left: ${originalMarginLeft - glowSize}px !important;
  padding-top: ${glowSize + originalPaddingTop}px !important;
  padding-right: ${glowSize + originalPaddingRight}px !important;
  padding-bottom: ${glowSize + originalPaddingBottom}px !important;
  padding-left: ${glowSize + originalPaddingLeft}px !important;
  border-color: transparent !important;
`
  return style
}

export function calculateInputStyle(element: HTMLElement): string {
  const computedStyle = getComputedStyle(element)
  const color = computedStyle.color
  const intensity = calculateGlowIntensity(color)
  const originalMarginLeft = parseInt(
    computedStyle.marginLeft.replace("px", "")
  )
  const originalTextIndent = parseInt(
    computedStyle.textIndent.replace("px", "")
  )

  // Generate a unique hash based on the glowStyles
  const style =
    element.id == "terminal-input"
      ? `
          text-shadow: 0 0 ${
            intensity * glowSize
          }px rgba(70%, 70%, 70%, ${intensity}) !important;
          margin-left: ${originalMarginLeft - glowSize}px;
          text-indent: ${originalTextIndent + glowSize}px;
          `
      : `
          text-shadow: 0 0 ${
            intensity * glowSize
          }px rgba(70%, 70%, 70%, ${intensity}) !important;
          `
  return style
}

// Function to calculate the luminance value of a given color
export function calculateGlowIntensity(color: string): number {
  // return 1.0
  const rgb = color.substring(4, color.length - 1).split(",")
  const r = parseInt(rgb[0].trim(), 10) / 255
  const g = parseInt(rgb[1].trim(), 10) / 255
  const b = parseInt(rgb[2].trim(), 10) / 255
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const intensity = 0.1 + luminance * 0.9
  return intensity
}

// Function to generate a hash based on a string
export function generateHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
  }
  return hash.toString(16)
}

export function getHash(element: HTMLElement): string {
  const classlist = element.classList
  const classNames = Array.from(classlist)
  const glowClassNames = classNames.filter(
    (className) => className !== "glow" && className.startsWith("glow")
  )
  if (glowClassNames.length > 0) {
    if (glowClassNames.length > 1)
      console.log("Multiple glow classes found on element")
    return glowClassNames[0].substring(4)
  }
  return ""
}

export function printStyleRules(rule: CSSStyleRule) {
  // css text and non empty values from style
  const cssText = rule.style.cssText
  const style = rule.style
  const styleKeys = Object.keys(style)
  const nonEmptyStyleKeys = styleKeys.filter(
    (key) => style[key as keyof CSSStyleDeclaration] !== ""
  )
  // const nonEmptyStyleText = nonEmptyStyle.join("; ")
  console.log(
    `${rule.selectorText}\n{ ${cssText} }`
    //`${rule.selectorText} { ${nonEmptyStyleText} }`
  )
}

export function addStyle(
  element: HTMLElement,
  style: string
): string | undefined {
  // Try to get the unique stylesheet by ID
  const sheet = getOrCreateStyleSheet()

  // Generate a unique hash based on the style
  const newHash = generateHash(style)
  if (newHash === "4b73e779e") {
    console.log("test")
  }
  const oldHash = getHash(element)

  if (oldHash === newHash) return `glow${newHash}`
  if (oldHash !== "") {
    console.log(`old hash: ${oldHash}\nnew hash: ${newHash}`)
  }
  // Create a new class name
  const newClassName = `glow${newHash}`

  if (!styleInStyleSheet(sheet, `.${newClassName}`)) {
    sheet.insertRule(`.${newClassName} { ${style} }`, sheet.cssRules.length)
  }
  element.classList.add(glowClass)
  element.classList.add(newClassName)
  return newClassName
}

export function addStyleAfter(
  element: HTMLElement,
  style: string,
  className: string
) {
  if (element.classList.contains("glow-after")) {
    return
  }
  const selector = `.${className}::after`

  const sheet = getOrCreateStyleSheet()
  if (!styleInStyleSheet(sheet, selector)) {
    sheet.insertRule(`${selector} { ${style} }`, sheet.cssRules.length)
  }

  element.classList.add("glow-after")
  // console.log("adding style after")
  // console.log(element.classList)
  // console.log(glowClass)
}

function getOrCreateStyleSheet() {
  const uniqueStyleSheetId = "glow-style-sheet"

  // Try to get the unique stylesheet by ID
  let styleSheet = doc.getElementById(
    uniqueStyleSheetId
  ) as HTMLStyleElement | null

  if (!styleSheet) {
    // If the unique stylesheet does not exist, create it.
    styleSheet = doc.createElement("style")
    styleSheet.id = uniqueStyleSheetId
    doc.head.appendChild(styleSheet)
  }

  const sheet = styleSheet.sheet as CSSStyleSheet
  return sheet
}

function styleInStyleSheet(sheet: CSSStyleSheet, selector: string): boolean {
  let ruleIndex = false
  for (let i = 0; i < sheet.cssRules.length; i++) {
    const rule = sheet.cssRules[i]
    if (rule instanceof CSSStyleRule && rule.selectorText === `${selector}`) {
      //console.log("glow class conflict:")
      //printStyleRules(rule as CSSStyleRule)
      ruleIndex = true
    }
  }
  return ruleIndex
}

// Remove glow effect from all elements
export function removeGlowFromAllElements() {
  const elementsWithGlow = doc.querySelectorAll(`.${glowClass}`)
  elementsWithGlow.forEach((element) => {
    const classList = element.classList
    const classNamesToRemove = Array.from(classList).filter((className) =>
      className.startsWith("glow")
    )
    classNamesToRemove.forEach((className) => classList.remove(className))
  })
  // Remove the unique stylesheet
  const styleSheet = doc.getElementById("glow-style-sheet")
  if (styleSheet) styleSheet.remove()
  // Remove the glow filters
  const filterElement = doc.querySelector("body > svg")
  if (filterElement) filterElement.remove()

  // Remove glow from skill bars
  const skillBarElements = doc.querySelectorAll(
    ".MuiLinearProgress-bar"
  ) as NodeListOf<HTMLElement>
  skillBarElements.forEach((element) => {
    element.style.transition = "none"
    element.style.width = ""
    win.requestAnimationFrame(() => {
      element.style.transition = ""
    })
  })

  // Restore old progress bars
  {
    /* Your CSS styles for the parent element here */
  }

  doc.querySelectorAll("p:has(.new-progress-bar)").forEach((element) => {
    console.log("restoring old progress bars")
    const span = element.querySelector("span.new-progress-bar")
    if (span) {
      const bars = span.getAttribute("bars")
      const dashes = span.getAttribute("dashes")
      if (bars && dashes) {
        console.log("bars: " + bars)
        console.log("dashes: " + dashes)

        // Create a text node with the old content
        const oldBar = generateOldProgressBar(parseInt(bars), parseInt(dashes))
        const textNode = doc.createTextNode(oldBar)

        // Replace the existing span with the text node
        element.replaceChild(textNode, span)
      }
    }
  })
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function generateOldProgressBar(bars: number, dashes: number): string {
  return "[" + "|".repeat(bars) + "-".repeat(dashes) + "]"
}

function generateNewProgressBar(bars: number, dashes: number): string | null {
  const size = bars + dashes
  if (size == 0) return null
  const bar =
    (bars ? "" + "".repeat(Math.min(bars - 1, size - 2)) : "") +
    (dashes ? "".repeat(Math.min(dashes - 1, size - 2)) + "" : "")
  return `<span class="expanded new-progress-bar" bars=${bars} dashes=${dashes} >${bar}</span>`
}
function generateNewProgressBarStyle(bars: number, dashes: number): string {
  const size = bars + dashes
  const expansion = (size + 2) / size
  return `display: inline-block; transform: scaleX(${expansion}); transform-origin: 0% 0%;`
}

export function replaceOldProgressBars(node: HTMLParagraphElement) {
  // If the node is a text node, replace any legacy progress bars in the text content
  const debug = false
  const newNode = debug ? node.cloneNode(true) : node

  if (newNode.textContent && newNode instanceof HTMLParagraphElement) {
    const content = newNode.textContent
    //ns.tprint("content: " + content)
    const matches = content.matchAll(/\[([|]*)([-]*)\]/g)
    if (matches) {
      for (const oldBar of matches) {
        if (oldBar.length != 3) return
        const bars = oldBar[1].length ?? 0
        const dashes = oldBar[2].length ?? 0
        const newBar = generateNewProgressBar(bars, dashes)
        if (newBar) {
          const newContent = newNode.textContent.replace(oldBar[0], newBar)
          newNode.innerHTML = newContent
          // newNode.style.whiteSpace = "pre"
          if (debug) {
            node.insertAdjacentElement("afterend", newNode)
          }
          const span = newNode.querySelector("span.expanded")
          if (span) {
            addStyle(
              span as HTMLElement,
              generateNewProgressBarStyle(bars, dashes)
            )
          }
        }
      }
    }
  }
}

// Stop observing mutations
export function stopObservingMutations() {
  // Access the observer reference from a different module
  const observer = (doc.body as any).mutationObserver

  if (observer) {
    // Disconnect and destroy the observer
    observer.disconnect()
    ;(doc.body as any).mutationObserver = null
  }
}

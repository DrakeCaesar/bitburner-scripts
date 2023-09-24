const glowClass = "glow"
const doc: Document = eval("document")
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
    const body = document.body
    let svg = body.querySelector("body > svg")

    if (!svg) {
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
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
  return 1.0
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
  const nonEmptyStyle = nonEmptyStyleKeys.map(
    (key) => `${key}: ${style[key as keyof CSSStyleDeclaration]}`
  )
  // const nonEmptyStyleText = nonEmptyStyle.join("; ")
  console.log(
    `${rule.selectorText}\n{ ${cssText} }`
    //`${rule.selectorText} { ${nonEmptyStyleText} }`
  )
}

export function addStyle(element: HTMLElement, style: string) {
  const uniqueStyleSheetId = "glow-style-sheet"

  // Try to get the unique stylesheet by ID
  let styleSheet = document.getElementById(
    uniqueStyleSheetId
  ) as HTMLStyleElement | null

  if (!styleSheet) {
    // If the unique stylesheet does not exist, create it.
    styleSheet = document.createElement("style")
    styleSheet.id = uniqueStyleSheetId
    document.head.appendChild(styleSheet)
  }

  // Generate a unique hash based on the style
  const newHash = generateHash(style)
  const oldHash = getHash(element)
  if (oldHash === newHash) return
  if (oldHash !== "") {
    // console.log("old hash: " + oldHash)
    // console.log("new hash: " + newHash)
    const oldGlowClass = `glow${oldHash}`
    const newGlowClass = `glow${newHash}`
    //print style from stylesheet for both classes

    const sheet = styleSheet.sheet as CSSStyleSheet
    for (let i = 0; i < sheet.cssRules.length; i++) {
      const rule = sheet.cssRules[i]
      if (
        rule instanceof CSSStyleRule &&
        rule.selectorText === `.${oldGlowClass}`
      ) {
        console.log("glow class conflict:")
        printStyleRules(rule as CSSStyleRule)
      }
    }
    for (let i = 0; i < sheet.cssRules.length; i++) {
      const rule = sheet.cssRules[i]
      if (
        rule instanceof CSSStyleRule &&
        rule.selectorText === `.${newGlowClass}`
      ) {
        console.log("new glow class style:")
        printStyleRules(rule as CSSStyleRule)
      }
    }

    //element.classList.remove(glowClass)
    //console.log("glow class conflict")
  }

  // Create a new class name
  const newClassName = `glow${newHash}`
  // Check if a rule with the same selector already exists in the unique stylesheet
  const sheet = styleSheet.sheet as CSSStyleSheet
  let ruleIndex = -1
  for (let i = 0; i < sheet.cssRules.length; i++) {
    const rule = sheet.cssRules[i]
    if (
      rule instanceof CSSStyleRule &&
      rule.selectorText === `.${newClassName}`
    ) {
      ruleIndex = i
      break
    }
  }
  // If a rule with the same selector doesn't exist; insert a new rule in the unique stylesheet
  if (ruleIndex === -1) {
    sheet.insertRule(`.${newClassName} { ${style} }`, sheet.cssRules.length)
  }
  // Add the generic glow class to the element's class list
  element.classList.add(glowClass)
  // Add the new class name to the element's class list
  element.classList.add(newClassName)
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
  const styleSheet = document.getElementById("glow-style-sheet")
  if (styleSheet) styleSheet.remove()
  // Remove the glow filters
  const filterElement = document.querySelector("body > svg")
  if (filterElement) filterElement.remove()
}

// Stop observing mutations
export function stopObservingMutations() {
  // Access the observer reference from a different module
  const observer = (document.body as any).mutationObserver

  if (observer) {
    // Disconnect and destroy the observer
    observer.disconnect()
    ;(document.body as any).mutationObserver = null
  }
}

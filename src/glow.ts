export async function main(): Promise<void> {
  // Define the CSS class for the glow effect
  const glowClass = "glow"
  const doc: Document = eval("document")
  const glowSize = 20

  // setInterval(toggleGlow, 500)
  toggleGlow()

  function toggleGlow() {
    // Check if the observer reference already exists
    if (!(document.body as any).mutationObserver) {
      const skillBarElements = document.querySelectorAll(
        ".MuiLinearProgress-bar"
      )
      skillBarElements.forEach((element) => {
        applyGlowEffectToSkillBar(element as HTMLSpanElement)
      })

      // Apply the glow effect to all input elements on page load
      applyGlowEffectToElementsInContainer(doc.body)
      createObserver()
    } else {
      // If the observer reference already exists, stop observing mutations and remove the glow effect
      stopObservingMutations()
      removeGlowFromAllElements()
    }

    // Get the element with id "unclickable"
    const unclickableElement = document.getElementById("unclickable")

    // Check if the element exists before modifying it
    if (unclickableElement) {
      // Set the inner text to an empty string
      unclickableElement.textContent = ""
    }
  }

  function createObserver() {
    // Set up a mutation observer to apply the effect to new input elements and progress bars
    const observer = new MutationObserver((mutationsList) => {
      for (const mutation of mutationsList) {
        if (mutation.type === "childList") {
          const addedElements = mutation.addedNodes
          addedElements.forEach((element) => {
            if (element instanceof HTMLElement) {
              applyGlowEffectToElementsInContainer(element)
            }
          })
        } else if (
          mutation.type === "attributes" &&
          mutation.attributeName === "style"
        ) {
          const element = mutation.target as HTMLElement
          if (
            element instanceof HTMLSpanElement &&
            element.classList.contains("MuiLinearProgress-bar")
          ) {
            applyGlowEffectToSkillBar(element)
          }
        }
      }
    })

    // Start observing mutations to the page
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["style"],
      childList: true,
      subtree: true,
    })

    // Store the observer reference on the DOM
    ;(document.body as any).mutationObserver = observer
  }

  // Function to calculate the luminance value of a given color
  function calculateGlowIntensity(color: string): number {
    const rgb = color.substring(4, color.length - 1).split(",")
    const r = parseInt(rgb[0].trim(), 10) / 255
    const g = parseInt(rgb[1].trim(), 10) / 255
    const b = parseInt(rgb[2].trim(), 10) / 255
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const intensity = 0.1 + luminance * 0.9
    return intensity
  }

  // Function to apply the glow effect to a given text element
  function applyGlowEffectToTextElement(element: HTMLElement) {
    const color = getComputedStyle(element).color
    const intensity = calculateGlowIntensity(color)
    const glowStyles = `
    text-shadow: 0 0 ${
      intensity * glowSize
    }px rgba(70%, 70%, 70%, ${intensity}) !important;
    overflow: visible;
  `
    addStyle(element, glowStyles)

    if (element.parentElement) {
      element.parentElement.style.overflow = "visible"
      if (
        element.parentElement.parentElement instanceof HTMLDivElement &&
        getComputedStyle(element.parentElement.parentElement).border.includes(
          "1px solid"
        )
      ) {
        element.parentElement.parentElement.style.overflow = "hidden"
      }
    }

    if (element instanceof HTMLParagraphElement) {
      replaceOldProgressBars(element)
    }
  }

  function addStyle(element: HTMLElement, style: string) {
    const uniqueStyleSheetId = "unique-style-sheet" // Unique ID for the stylesheet

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
    const hash = generateHash(style)

    // Create a new class name
    const newClassName = `glow${hash}`

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

    // Add the new class name to the element's class list
    element.classList.add(newClassName)
  }

  // Helper function to check if a CSSRule is a CSSStyleRule
  function isCSSStyleRule(rule: CSSRule): rule is CSSStyleRule {
    // Use constructor.name to check the type
    return rule.constructor.name === "CSSStyleRule"
  }

  // Function to generate a hash based on a string
  function generateHash(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
    }
    return hash.toString(16)
  }

  function generateNewProgressBar(bars: number, dashes: number): string | null {
    const size = bars + dashes
    if (size == 0) return null
    const bar =
      (bars ? "" + "".repeat(Math.min(bars - 1, size - 2)) : "") +
      (dashes ? "".repeat(Math.min(dashes - 1, size - 2)) + "" : "")
    const expansion = (size + 2) / size
    return `<span class="expanded" style="display: inline-block; transform: scaleX(${expansion}); transform-origin: 0% 0%;">${bar}</span>`
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function generateOldProgressBar(bars: number, dashes: number): string {
    return "[" + "|".repeat(bars) + "-".repeat(dashes) + "]"
  }

  function replaceOldProgressBars(node: HTMLParagraphElement) {
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
            newNode.style.whiteSpace = "pre"
            if (debug) {
              node.insertAdjacentElement("afterend", newNode)
            }
          }
        }
      }
    }
  }

  // Function to apply the glow effect to an SVG element
  function applyGlowEffectToSvgElement(element: HTMLElement) {
    let color = getComputedStyle(element).fill
    if (color === "rgb(0, 0, 0)") {
      const heading = element.parentElement?.nextSibling
        ?.firstChild as HTMLElement
      color = getComputedStyle(heading).color
    }
    const intensity = calculateGlowIntensity(color)
    const opacity = intensity
    const filter = doc.createElementNS("http://www.w3.org/2000/svg", "filter")
    const feDropShadow = doc.createElementNS(
      "http://www.w3.org/2000/svg",
      "feDropShadow"
    )
    feDropShadow.setAttribute("dx", "0")
    feDropShadow.setAttribute("dy", "0")
    feDropShadow.setAttribute("stdDeviation", `${glowSize / 2}`)
    feDropShadow.setAttribute("flood-color", "white")
    feDropShadow.setAttribute("flood-opacity", String(opacity))
    const hash = generateHash(feDropShadow.outerHTML)
    filter.setAttribute("id", `glow-filter${hash}`)
    filter.appendChild(feDropShadow)
    const filterElement = doc.body.querySelector(`#glow-filter${hash}`)
    if (!filterElement) {
      const body = document.body
      let svg = body.querySelector("body > svg")

      if (!svg) {
        svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
        if (body.firstChild) {
          body.insertBefore(svg, body.firstChild) // Insert the SVG as the first child of the body
        } else {
          body.appendChild(svg) // This is just a fallback in case there are no elements inside the body
        }
      }

      svg.appendChild(filter)
    }

    const computedStyle = getComputedStyle(element)

    const originalMarginTop = parseInt(
      computedStyle.marginTop.replace("px", "")
    )
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

    const glowStyles = `
      filter: ${element.style.filter ?? ""} url(#glow-filter${hash}) !important;
      margin-top: ${originalMarginTop - glowSize}px !important;
      margin-right: ${originalMarginRight - glowSize}px !important;
      margin-bottom: ${originalMarginBottom - glowSize}px !important;
      margin-left: ${originalMarginLeft - glowSize}px !important;
      padding-top: ${glowSize + originalPaddingTop}px !important;
      padding-right: ${glowSize + originalPaddingRight}px !important;
      padding-bottom: ${glowSize + originalPaddingBottom}px !important;
      padding-left: ${glowSize + originalPaddingLeft}px !important;
    `

    addStyle(element, glowStyles)
  }

  // Function to apply the glow effect to an input element
  function applyGlowEffectToInputElement(element: HTMLInputElement) {
    const color = getComputedStyle(element).color
    const intensity = calculateGlowIntensity(color)
    const originalMarginLeft = parseInt(
      getComputedStyle(element).marginLeft.replace("px", "")
    )
    const originalTextIndent = parseInt(
      getComputedStyle(element).textIndent.replace("px", "")
    )

    // Generate a unique hash based on the glowStyles
    const glowStyles =
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
    addStyle(element, glowStyles)
  }

  // Function to apply the glow effect to a skill bar element
  function applyGlowEffectToSkillBar(element: HTMLSpanElement) {
    const color = getComputedStyle(element).backgroundColor
    const intensity = calculateGlowIntensity(color)

    // Generate a unique hash based on the boxShadowStyle
    const boxShadowStyle = `0 0 ${
      intensity * glowSize
    }px rgba(70%, 70%, 70%, ${intensity})`

    addStyle(element, boxShadowStyle)

    const parent = element.parentElement
    if (parent != null) {
      parent.style.overflow = "visible"
      const transform = element.style.transform
      const translateXRegex = /([-0-9]+.[0-9]+)/
      const translateX: number = parseFloat(
        transform.match(translateXRegex)?.[1] ?? ""
      )
      if (translateX < -1 && translateX > -100) {
        const width = (parent.offsetWidth / 100) * (100 + translateX)
        element.style.width = `${width}px`
        element.style.transform = "translateX(0%)"
        element.style.transition = "none"
      }
    }
  }

  // Function to apply the glow effect to all elements in a given container
  function applyGlowEffectToElementsInContainer(container: HTMLElement) {
    const textNodes = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: (node: Node) => {
        const parent = node.parentElement
        if (
          parent &&
          parent.nodeName !== "SCRIPT" &&
          parent.nodeName !== "STYLE" &&
          parent.nodeName !== "IFRAME" &&
          !parent.classList.contains(glowClass) &&
          !/^\s*$/.test(node.textContent || "")
        ) {
          return NodeFilter.FILTER_ACCEPT
        }
        return NodeFilter.FILTER_SKIP
      },
    })

    let currentNode: Node | null
    while ((currentNode = textNodes.nextNode())) {
      const testing = false
      if (testing) {
        const styleAttributeValue =
          currentNode.parentElement?.getAttribute("style")

        const exclusionCriteria: ((style: any) => any)[] = [
          // Easter egg element
          (style) => style.includes("display: none; visibility: hidden;"),
          // Stats page stats
          (style) => style.includes("color: rgb(207, 207, 207);"),
          (style) => style.includes("color: rgb(135, 136, 189);"),
          (style) => style.includes("color: rgb(251, 121, 219);"),
          (style) => style.includes("color: rgb(249, 227, 95);"),
          (style) => style.includes("color: rgb(124, 243, 184);"),
          (style) => style.includes("color: rgb(250, 255, 223);"),
          (style) => style.includes("opacity: 0.5;"),
          // Console folders
          (style) => style.includes("color: cyan;"),
          // Stock market stocks
          (style) => style.includes("white-space: pre;"),
          // Job modal
          (style) => style.includes("white-space: pre-wrap;"),

          // Factions page elements - faction names
          (style) =>
            style.includes(
              "overflow: hidden; white-space: nowrap; text-overflow: ellipsis;"
            ),
          //Hacknet Nodes
          (style) => style.includes("overflow: visible;"),

          // Tooltips
          (style) =>
            style.includes(
              "opacity: 1; transform: scale(1, 1); transition: opacity 200ms cubic-bezier(0.4, 0, 0.2, 1) 0ms, transform 133ms cubic-bezier(0.4, 0, 0.2, 1) 0ms;"
            ),
        ]

        if (
          styleAttributeValue !== null &&
          styleAttributeValue !== undefined &&
          styleAttributeValue.trim() !== ""
        ) {
          // Check if the style attribute matches any exclusion criteria
          const containsExcludedStyle = exclusionCriteria.some((criterion) =>
            criterion(styleAttributeValue)
          )
          if (!containsExcludedStyle) {
            console.log(`Style Attribute: ${styleAttributeValue}`)
            continue
          }
        }
      }
      if (currentNode.parentElement instanceof SVGElement) {
        applyGlowEffectToSvgElement(currentNode.parentElement)
      } else if (currentNode.parentElement instanceof HTMLImageElement) {
        applyGlowEffectToSvgElement(currentNode.parentElement)
      } else if (currentNode.parentElement instanceof HTMLElement) {
        applyGlowEffectToTextElement(currentNode.parentElement)
      }
    }

    const inputElements = container.querySelectorAll("input[type='text']")
    inputElements.forEach(function (inputElement) {
      applyGlowEffectToInputElement(inputElement as HTMLInputElement)
    })

    const svgElements = container.querySelectorAll("svg, img")
    svgElements.forEach(function (svgElement) {
      applyGlowEffectToSvgElement(svgElement as HTMLElement)
    })
  }

  // Function to remove glow effect from an SVG element
  function removeGlowFromSvgElement(element: HTMLElement) {
    const filterValue = element.style.filter

    // Check if the element has the glow filter applied
    if (filterValue && filterValue.includes('url("#glow-filter")')) {
      // Remove the glow filter from the filter list
      const newFilterValue = filterValue
        .replaceAll('url("#glow-filter")', "")
        .trim()
      element.style.filter = newFilterValue

      // If there's a direct child filter element with the id "glow-filter", remove it
      const filterElement = element.querySelector("#glow-filter")
      if (filterElement) filterElement.remove()

      // Reset styles applied in `applyGlowEffectToSvgElement`
      element.style.margin = ""
      element.style.padding = ""
    }
  }

  // Remove glow effect from all elements
  function removeGlowFromAllElements() {
    // Remove glow effect from elements with glowClass and matching glow-hash classes
    const elementsWithGlow = doc.querySelectorAll(`.${glowClass}`)
    elementsWithGlow.forEach((element) => {
      const classList = element.classList
      const classNamesToRemove = Array.from(classList).filter((className) =>
        className.startsWith("glow")
      )
      classNamesToRemove.forEach((className) => classList.remove(className))
    })
  }

  // Stop observing mutations
  function stopObservingMutations() {
    // Access the observer reference from a different module
    const observer = (document.body as any).mutationObserver

    if (observer) {
      // Disconnect and destroy the observer
      observer.disconnect()
      ;(document.body as any).mutationObserver = null
    }
  }
}

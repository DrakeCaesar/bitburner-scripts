export async function main(): Promise<void> {
  // Define the CSS class for the glow effect
  const glowClass = "glow"
  const doc: Document = eval("document")
  const glowSize = 20

  // Check if the observer reference already exists
  if (!(document.body as any).mutationObserver) {
    const skillBarElements = document.querySelectorAll(".MuiLinearProgress-bar")
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
        }px rgba(255, 255, 255, ${intensity}) !important;
        overflow: visible;
        `

    if (element.parentElement) {
      element.parentElement.style.overflow = "visible"
      if (
        element.parentElement.parentElement instanceof HTMLDivElement &&
        getComputedStyle(element.parentElement.parentElement).border.includes(
          "1px solid"
        )
      )
        element.parentElement.parentElement.style.overflow = "hidden"
    }

    element.classList.add(glowClass)
    element.style.cssText += glowStyles

    if (element instanceof HTMLParagraphElement) {
      replaceOldProgressBars(element)
    }
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
    const color = getComputedStyle(element).fill
    const intensity = calculateGlowIntensity(color)
    const opacity = intensity
    const filter = doc.createElementNS("http://www.w3.org/2000/svg", "filter")
    filter.setAttribute("id", "glow-filter")
    const feDropShadow = doc.createElementNS(
      "http://www.w3.org/2000/svg",
      "feDropShadow"
    )
    feDropShadow.setAttribute("dx", "0")
    feDropShadow.setAttribute("dy", "0")
    feDropShadow.setAttribute("stdDeviation", `${glowSize / 2}`)
    feDropShadow.setAttribute("flood-color", "white")
    feDropShadow.setAttribute("flood-opacity", String(opacity))
    filter.appendChild(feDropShadow)
    element.insertBefore(filter, element.firstChild)

    const filterText = element.style.filter
    if (filterText == "") {
      element.style.filter = "url(#glow-filter)"
    } else if (!filterText.includes("url(#glow-filter)")) {
      element.style.filter = `${filterText} url(#glow-filter)`
    }
    const originalMargin = parseInt(
      getComputedStyle(element).margin.replace("px", "")
    )
    const originalPadding = parseInt(
      getComputedStyle(element).padding.replace("px", "")
    )
    //console.log("originalPadding: " + originalPadding)
    element.style.margin = `-${glowSize + originalMargin}px`
    element.style.padding = `${glowSize + originalPadding}px`
  }

  // Function to apply the glow effect to an input element
  function applyGlowEffectToInputElement(element: HTMLInputElement) {
    const color = getComputedStyle(element).color
    const intensity = calculateGlowIntensity(color)
    const glowStyles = `
           text-shadow: 0 0 ${
             intensity * glowSize
           }px rgba(255, 255, 255, ${intensity}) !important;
           margin-left: -120px;
           text-indent: 120px;
           line-height: 2;
        `
    element.classList.add(glowClass)
    element.style.cssText += glowStyles
    const parent = element.parentNode as HTMLElement
    if (parent && parent.classList.contains("MuiInputBase-root")) {
      parent.style.backgroundColor = "transparent"
    }
  }

  function applyGlowEffectToSkillBar(element: HTMLSpanElement) {
    const color = getComputedStyle(element).backgroundColor
    const intensity = calculateGlowIntensity(color)
    const boxShadowStyle = `0 0 ${
      intensity * glowSize
    }px rgba(255, 255, 255, a${intensity}`

    element.style.boxShadow = boxShadowStyle
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

  // Function to remove glow effect from an element
  function removeGlowFromElement(element: HTMLElement) {
    if (element instanceof SVGElement || element instanceof HTMLImageElement) {
      removeGlowFromSvgElement(element)
    } else {
      element.classList.remove(glowClass)
      element.style.cssText = ""
    }
  }

  // Function to reset styles applied to elements affected by the glow effect
  function resetStylesForGlowEffect(element: HTMLElement) {
    const parent = element.parentElement
    if (parent != null) {
      parent.style.overflow = "" // Reset overflow to its original value
      element.style.width = "" // Reset the width property
      element.style.transform = "" // Reset the transform property
      element.style.transition = "" // Reset the transition property
    }
  }

  // Remove glow effect from all elements
  function removeGlowFromAllElements() {
    const elementsWithGlow = doc.querySelectorAll(`.${glowClass}`)
    elementsWithGlow.forEach((element) =>
      removeGlowFromElement(element as HTMLElement)
    )

    // Additionally, look for any SVG or image elements with the filter applied directly
    const svgElementsWithFilter = doc.querySelectorAll(
      `svg[style*='url("#glow-filter")'], img[style*='url("#glow-filter")']`
    )
    svgElementsWithFilter.forEach((element) =>
      removeGlowFromSvgElement(element as HTMLElement)
    )

    // Remove glow effect from skill bars with class .MuiLinearProgress-bar
    const skillBarElements = doc.querySelectorAll(".MuiLinearProgress-bar")
    skillBarElements.forEach((element) => {
      removeGlowFromElement(element as HTMLElement)
      resetStylesForGlowEffect(element as HTMLElement)
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

import {
  addStyle,
  calculateGlowIntensity,
  calculateInputStyle,
  calculateSvgStyle,
  removeGlowFromAllElements,
  stopObservingMutations,
} from "./libraries/glowHelpFunction"

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
      // TODO: Fix progress bar glow
      // const skillBarElements = document.querySelectorAll(
      //   ".MuiLinearProgress-bar"
      // )
      // skillBarElements.forEach((element) => {
      //   applyGlowEffectToSkillBar(element as HTMLSpanElement)
      // })

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
          mutation.attributeName === "class"
        ) {
          const element = mutation.target as HTMLElement
          if (element instanceof HTMLElement) {
            applyGlowEffectToElementsInContainer(element)
          }
        }
      }
    })

    // Start observing mutations to the page
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
      childList: true,
      subtree: true,
    })

    // Store the observer reference on the DOM
    ;(document.body as any).mutationObserver = observer
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
      // TODO: Figure out if I need this
      //addStyle(element.parentElement, "overflow: visible")
      if (
        element.parentElement.parentElement instanceof HTMLDivElement &&
        getComputedStyle(element.parentElement.parentElement).border.includes(
          "1px solid"
        )
      ) {
        // TODO: Figure out if I need this
        //addStyle(element.parentElement.parentElement, "overflow: hidden")
      }
    }

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

  function applyGlowEffectToSvgElement(element: HTMLElement) {
    addStyle(element, calculateSvgStyle(element))
  }

  // Function to apply the glow effect to an input element
  function applyGlowEffectToInputElement(element: HTMLInputElement) {
    addStyle(element, calculateInputStyle(element))
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
      const barParentStyle = "overflow: visible"
      // TODO: Fix progress bar glow
      // addStyle(parent, barParentStyle)
      const transform = getComputedStyle(element).transform
      const translateXRegex = /([-0-9]+.[0-9]+)/
      const translateX: number = parseFloat(
        transform.match(translateXRegex)?.[1] ?? ""
      )
      if (translateX < -1 && translateX > -100) {
        const width = (parent.offsetWidth / 100) * (100 + translateX)
        const barStyle = `width: ${width}px; transform: translateX(0%); transition: none;`
        // TODO: Fix progress bar glow
        addStyle(element, barStyle)
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
      // Continue if the current node already has the glow effect applied
      if (currentNode.parentElement?.classList.contains(glowClass)) continue
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
      if (!inputElement.classList.contains(glowClass))
        applyGlowEffectToInputElement(inputElement as HTMLInputElement)
    })

    const svgElements = container.querySelectorAll("svg, img")
    svgElements.forEach(function (svgElement) {
      if (!svgElement.classList.contains(glowClass))
        applyGlowEffectToSvgElement(svgElement as HTMLElement)
    })
  }

  // Function to remove glow effect from an SVG element
}

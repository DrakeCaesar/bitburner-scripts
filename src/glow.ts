import {
  addStyle,
  addStyleAfter,
  calculateGlowIntensity,
  calculateInputStyle,
  calculateSvgStyle,
  createAcrylicAfterStyle,
  createAcrylicStyle,
  createColorWithTransparency,
  GLOW_CONFIG,
  removeGlowFromAllElements,
  replaceOldProgressBars,
  stopObservingMutations,
} from "./libraries/glowHelpFunction.js"

export async function main(): Promise<void> {
  // Define the CSS class for the glow effect
  const glowClass = "glow"
  const doc: Document = eval("document")
  const glowSize = 20

  toggleGlow()

  function toggleGlow() {
    // Check if the observer reference already exists
    if (!(doc.body as any).mutationObserver) {
      applyGlowEffectToSkillBars()

      // Apply the glow effect to all input elements on page load
      applyGlowEffectToElementsInContainer(doc.body)
      const terminalDiv = doc.querySelector(".MuiInputBase-adornedStart")
      if (terminalDiv instanceof HTMLDivElement) {
        applyGlowEffectToTerminal(terminalDiv)
      }
      const overviewDiv = doc.querySelector(".react-draggable")
      if (overviewDiv instanceof HTMLDivElement) {
        applyGlowEffectToOverview(overviewDiv)
      }

      createObserver()
    } else {
      // If the observer reference already exists, stop observing mutations and remove the glow effect
      stopObservingMutations()
      removeGlowFromAllElements()
    }

    // Get the element with id "unclickable"
    const unclickableElement = doc.getElementById("unclickable")

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
            console.log(element.className)
            applyGlowEffectToElementsInContainer(element)
            applyGlowEffectToSkillBars()
          }
        } else if (
          mutation.type === "attributes" &&
          mutation.attributeName === "style"
        ) {
          const element = mutation.target as HTMLElement
          if (element.classList.contains("MuiLinearProgress-bar")) {
            applyGlowEffectToSkillBars()
          } else if (element.classList.contains("MuiTableCell-root")) {
            applyGlowEffectToSkillBars()
          }
        }
      }
    })

    // Start observing mutations to the page
    observer.observe(doc.body, {
      attributes: true,
      attributeFilter: ["class", "style"],
      childList: true,
      subtree: true,
    })

    // Store the observer reference on the DOM
    ;(doc.body as any).mutationObserver = observer
  }

  // Function to apply the glow effect to a given text element
  function applyGlowEffectToTextElement(element: HTMLElement) {
    const color = getComputedStyle(element).color
    const intensity = calculateGlowIntensity(color)
    const glowStyles = `
      text-shadow:
        0 0 ${intensity * glowSize * 1}px rgba(70%, 70%, 70%, ${intensity});
      overflow: visible !important;
    `

    addStyle(element, glowStyles)

    if (element.parentElement) {
      if (
        element.parentElement.parentElement instanceof HTMLDivElement &&
        getComputedStyle(element.parentElement.parentElement).border.includes(
          "1px solid"
        )
      ) {
        // Border handling logic could go here if needed
      }
    }

    if (element instanceof HTMLParagraphElement) {
      replaceOldProgressBars(element)
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
  function updateSkillBars() {
    const skillBarElements = doc.querySelectorAll(
      ".MuiLinearProgress-bar"
    ) as NodeListOf<HTMLElement>
    if (skillBarElements.length == 0) return
    const parent = skillBarElements.item(0).parentElement
    if (parent == null) return
    skillBarElements.forEach((element) => {
      const transform = element.style.transform
      const translateXRegex = /([-0-9]+.[0-9]+)/
      const translateX: number = parseFloat(
        transform.match(translateXRegex)?.[1] ?? ""
      )
      if (translateX < -1 && translateX > -100) {
        const width = (parent.offsetWidth / 100) * (100 + translateX)
        element.style.width = `${width}px`
        element.style.transform = "translateX(0%)"
      }
    })
  }

  function applyGlowEffectToSkillBars() {
    const skillBarElements = doc.querySelectorAll(
      ".MuiLinearProgress-bar"
    ) as NodeListOf<HTMLElement>

    skillBarElements.forEach((element) => {
      const parent = element.parentElement
      if (parent == null) return

      const transform = element.style.transform
      const translateXRegex = /([-0-9]+.[0-9]+)/
      const translateX: number = parseFloat(
        transform.match(translateXRegex)?.[1] ?? ""
      )
      if (!isNaN(translateX)) {
        const width = (parent.offsetWidth / 100) * (100 + translateX)
        element.style.width = `${width}px`
      }

      // Check if this element already has our transform override
      const currentTransform = getComputedStyle(element).transform
      if (currentTransform === "translateX(0px)") {
        // Element already processed, just update the width if needed
        return
      }

      const color = getComputedStyle(element).backgroundColor
      const intensity = calculateGlowIntensity(color)
      const boxShadowStyle = `box-shadow: 0 0 ${
        intensity * glowSize
      }px rgba(70%, 70%, 70%, ${intensity});`

      // Apply glow and smooth width transition
      const barStyle = `
        transform: translateX(0%) !important; 
        transition: width 0.4s linear !important;
      `
      addStyle(element, `${boxShadowStyle} ${barStyle}`)
    })
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

    // Special case for the terminal
    if (container.classList.contains("MuiInputBase-adornedStart")) {
      applyGlowEffectToTerminal(container)
    }

    // Special case for the overview
    if (container.classList.contains("react-draggable")) {
      applyGlowEffectToOverview(container)
    }

    //Special case for overflow
    if (container.classList.contains("MuiBox-root")) {
      addStyle(container, "overflow: visible !important")
    }
  }
}
function applyGlowEffectToOverview(container: HTMLElement) {
  // Additional styles for the panel
  const className = addStyle(container, createAcrylicStyle())

  if (className != undefined) {
    addStyleAfter(container, createAcrylicAfterStyle(), className)
  }

  // Existing logic for bars and table
  const bars = container.querySelectorAll(".MuiLinearProgress-determinate")
  bars.forEach((element) => {
    const color = createColorWithTransparency(
      getComputedStyle(element).backgroundColor,
      GLOW_CONFIG.progressBarTransparency
    )
    addStyle(
      element as HTMLElement,
      `
      background-color: ${color}; 
      overflow: visible;
      `
    )
  })

  const table = container.querySelectorAll(
    `
    table tr:nth-child(n+3):nth-child(-n+15) td,
    table tr:nth-child(n+3):nth-child(-n+15) th
    `
  )
  table.forEach((element) => {
    addStyle(element as HTMLElement, `border-bottom-color: transparent`)
  })
}

function applyGlowEffectToTerminal(container: HTMLElement) {
  const color = getComputedStyle(container).backgroundColor
  const semiTransparentColor = createColorWithTransparency(
    color,
    GLOW_CONFIG.terminalTransparency
  )
  addStyle(container, `background-color: ${semiTransparentColor}`)
}

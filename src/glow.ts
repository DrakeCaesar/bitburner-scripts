import {
  addStyle,
  calculateGlowIntensity,
  calculateInputStyle,
  calculateSvgStyle,
  removeGlowFromAllElements,
  replaceOldProgressBars,
  stopObservingMutations,
} from "./libraries/glowHelpFunction"

export async function main(): Promise<void> {
  // Define the CSS class for the glow effect
  const glowClass = "glow"
  const doc: Document = eval("document")
  const glowSize = 20

  toggleGlow()
  // setInterval(toggleGlow, 5000)
  // setTimeout(() => {
  //   // toggleGlow()
  //   setInterval(toggleGlow, 500)
  // }, 3000)

  function toggleGlow() {
    // Check if the observer reference already exists
    if (!(document.body as any).mutationObserver) {
      applyGlowEffectToSkillBars()

      // Apply the glow effect to all input elements on page load
      applyGlowEffectToElementsInContainer(doc.body)
      const terminalDiv = document.querySelector(".MuiInputBase-adornedStart")
      if (terminalDiv instanceof HTMLDivElement) {
        applyGlowEffectToTerminal(terminalDiv)
      }
      const overviewDiv = document.querySelector(".react-draggable")
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

  function applyGlowEffectToSvgElement(element: HTMLElement) {
    addStyle(element, calculateSvgStyle(element))
  }

  // Function to apply the glow effect to an input element
  function applyGlowEffectToInputElement(element: HTMLInputElement) {
    addStyle(element, calculateInputStyle(element))
  }

  // Function to apply the glow effect to a skill bar element
  function applyGlowEffectToSkillBars() {
    const skillBarElements = document.querySelectorAll(
      ".MuiLinearProgress-bar"
    ) as NodeListOf<HTMLElement>
    skillBarElements.forEach((element) => {
      const color = getComputedStyle(element).backgroundColor
      const intensity = calculateGlowIntensity(color)

      // Generate a unique hash based on the boxShadowStyle
      const boxShadowStyle = `box-shadow: 0 0 ${
        intensity * glowSize
      }px rgba(70%, 70%, 70%, ${intensity});`

      const parent = element.parentElement
      if (parent != null) {
        const barParentStyle = "overflow: visible"
        // addStyle(parent, barParentStyle)
        const transform = element.style.transform
        const translateXRegex = /([-0-9]+.[0-9]+)/
        const translateX: number = parseFloat(
          transform.match(translateXRegex)?.[1] ?? ""
        )
        if (translateX < -1 && translateX > -100) {
          const width = (parent.offsetWidth / 100) * (100 + translateX)
          const barStyle = `transform: translateX(0%) !important; transition: none`
          addStyle(element, `${boxShadowStyle} ${barStyle}`)
          element.style.width = `${width}px`
        } else {
          addStyle(element, `${boxShadowStyle}`)
        }
      } else {
        addStyle(element, `${boxShadowStyle}`)
      }
    })
  }

  // Function to apply the glow effect to all elements in a given container
  function applyGlowEffectToElementsInContainer(container: HTMLElement) {
    //console.log("Applying glow effect to element:", container)

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

    // Special case for the skill bars
    if (container.classList.contains("MuiLinearProgress-bar")) {
      applyGlowEffectToSkillBars()
    }
  }
}
function applyGlowEffectToOverview(container: HTMLElement) {
  const color = createColorWithTransparency(
    getComputedStyle(container).backgroundColor,
    0.8
  )
  addStyle(container, `background-color: ${color}`)

  // const buttons = container.querySelectorAll("button.MuiButton-textSizeMedium")
  // buttons.forEach((element) => {
  //   const color = createColorWithTransparency(
  //     getComputedStyle(element).backgroundColor,
  //     0.5
  //   )
  //   addStyle(element as HTMLElement, `background-color: ${color}`)
  // })

  const bars = container.querySelectorAll(".MuiLinearProgress-determinate")
  bars.forEach((element) => {
    const color = createColorWithTransparency(
      getComputedStyle(element).backgroundColor,
      0.5
    )
    addStyle(
      element as HTMLElement,
      `background-color: ${color}; overflow: visible;`
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
  const semiTransparentColor = createColorWithTransparency(color, 0.8)
  addStyle(container, `background-color: ${semiTransparentColor}`)
}

function createColorWithTransparency(color: string, transparency: number) {
  const rgbValues = color.match(/\d+/g)
  if (rgbValues) {
    const red = rgbValues[0]
    const green = rgbValues[1]
    const blue = rgbValues[2]
    return `rgba(${red}, ${green}, ${blue}, ${transparency})`
  }
  return color
}

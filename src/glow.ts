import { NS } from "@ns"

export async function main(ns: NS): Promise<void> {
   // Define the CSS class for the glow effect
   const glowClass = "glow"
   const doc: Document = eval("document")

   const inputRoot = doc.querySelector<HTMLElement>(".MuiInputBase-root")
   if (inputRoot) {
      inputRoot.style.backgroundColor = "transparent"
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
               intensity * 10
            }px rgba(255, 255, 255, ${intensity}) !important;
      `
      element.classList.add(glowClass)
      element.style.cssText += glowStyles
   }

   // Function to apply the glow effect to an SVG element
   function applyGlowEffectToSvgElement(element: SVGElement) {
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
      feDropShadow.setAttribute("stdDeviation", "5")
      feDropShadow.setAttribute("flood-color", "white")
      feDropShadow.setAttribute("flood-opacity", String(opacity))
      filter.appendChild(feDropShadow)
      element.insertBefore(filter, element.firstChild)
      element.style.filter = "url(#glow-filter)"
      element.style.margin = "-10px"
      element.style.padding = "10px"
   }

   // Function to apply the glow effect to an input element
   function applyGlowEffectToInputElement(element: HTMLInputElement) {
      const color = getComputedStyle(element).color
      const intensity = calculateGlowIntensity(color)
      const glowStyles = `
         text-shadow: 0 0 ${
            intensity * 10
         }px rgba(255, 255, 255, ${intensity}) !important;
         margin-left: -10px;
         text-indent: 10px;
      `
      element.classList.add(glowClass)
      element.style.cssText += glowStyles
   }

   function applyGlowEffectToProgressBar() {
      const selector = ".MuiLinearProgress-bar"
      const elements: NodeListOf<HTMLSpanElement> =
         document.querySelectorAll(selector)
      elements.forEach((element: HTMLSpanElement) => {
         const color = getComputedStyle(element).backgroundColor
         const intensity = calculateGlowIntensity(color)
         const boxShadowStyle = `0 0 ${
            intensity * 10
         }px rgba(255, 255, 255, ${intensity}`

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
         if (currentNode.parentElement instanceof SVGElement) {
            applyGlowEffectToSvgElement(currentNode.parentElement)
         } else if (currentNode.parentElement instanceof HTMLElement) {
            applyGlowEffectToTextElement(currentNode.parentElement)
         }
      }

      const inputElements = container.querySelectorAll("input[type='text']")
      for (const inputElement of inputElements) {
         if (inputElement instanceof HTMLInputElement) {
            applyGlowEffectToInputElement(inputElement)
         }
      }

      const svgElements = container.getElementsByTagName("svg")
      for (const svgElement of svgElements) {
         if (svgElement instanceof SVGElement) {
            applyGlowEffectToSvgElement(svgElement)
         }
      }
      applyGlowEffectToProgressBar()
   }

   // Apply the glow effect to all input elements on page load
   applyGlowEffectToElementsInContainer(doc.body)

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
            applyGlowEffectToProgressBar() // call the function when style attribute changes
         }
      }
   })

   // Start observing mutations to the page
   observer.observe(doc.body, {
      attributes: true,
      attributeFilter: ["style"],
      childList: true,
      subtree: true,
   })
}

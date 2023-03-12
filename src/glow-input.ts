import { NS } from "@ns"

export async function main(ns: NS): Promise<void> {
   // Define the CSS class for the glow effect
   const glowClass = "glow"

   // Function to calculate the luminance value of a given color
   function calculateLuminance(color: string): number {
      const rgb = color.substring(4, color.length - 1).split(",")
      const r = parseInt(rgb[0].trim(), 10) / 255
      const g = parseInt(rgb[1].trim(), 10) / 255
      const b = parseInt(rgb[2].trim(), 10) / 255
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
   }

   // Function to apply the glow effect to a given input element
   function applyGlowEffectToInputElement(element: HTMLInputElement) {
      const color = getComputedStyle(element).color
      const luminance = calculateLuminance(color)
      const intensity = 0.1 + luminance * 0.9
      const glowStyles = `
            text-shadow: 0 0 ${
               intensity * 10
            }px rgba(255, 255, 255, ${intensity}) !important;
        `
      element.classList.add(glowClass)
      element.style.cssText += glowStyles
   }

   // Function to apply the glow effect to all input elements in a given element
   function applyGlowEffectToElementsInContainer(container: HTMLElement) {
      const inputElements = container.querySelectorAll("input[type=text]")
      for (const inputElement of inputElements) {
         if (inputElement instanceof HTMLInputElement) {
            // type-checking
            applyGlowEffectToInputElement(inputElement)
         }
      }
   }

   // Apply the glow effect to all input elements on page load
   applyGlowEffectToElementsInContainer(document.body)

   // Set up a mutation observer to apply the effect to new input elements
   const observer = new MutationObserver((mutationsList) => {
      for (const mutation of mutationsList) {
         if (mutation.type === "childList") {
            const addedElements = mutation.addedNodes
            addedElements.forEach((element) => {
               if (element instanceof HTMLElement) {
                  applyGlowEffectToElementsInContainer(element)
               }
            })
         }
      }
   })

   // Start observing mutations to the page
   observer.observe(document.body, {
      childList: true,
      subtree: true,
   })

   // Listen for input events and apply the effect to the input element's value
   document.addEventListener("input", (event) => {
      const target = event.target
      if (
         target instanceof HTMLInputElement &&
         target.type === "text" &&
         target.classList.contains(glowClass)
      ) {
         target.style.cssText += `
                text-shadow: 0 0 ${
                   calculateLuminance(getComputedStyle(target).color) * 10
                }px rgba(255, 255, 255, ${calculateLuminance(
            getComputedStyle(target).color
         )}) !important;
            `
      }
   })
}

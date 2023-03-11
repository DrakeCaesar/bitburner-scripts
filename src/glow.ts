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

   // Function to apply the glow effect to a given text element
   function applyGlowEffectToElement(element: HTMLElement) {
      const color = getComputedStyle(element).color
      const luminance = calculateLuminance(color)
      const intensity = 0.1 + luminance * 0.9
      const glowStyles = `
        text-shadow: 0 0 ${intensity * 10}px rgba(255, 255, 255, ${intensity});
    `
      element.classList.add(glowClass)
      element.style.cssText += glowStyles
   }

   // Function to apply the glow effect to all text elements on the page
   function applyGlowEffectToAllElements() {
      const textElements = document.querySelectorAll(
         ":not(iframe):not(script):not(style):not([class*=glow]) :not(:empty):not(:has(*))"
      )
      textElements.forEach((element) => {
         applyGlowEffectToElement(element as HTMLElement)
      })
   }

   // Apply the glow effect to all text elements on page load
   applyGlowEffectToAllElements()

   // Set up a mutation observer to apply the effect to new text elements
   const observer = new MutationObserver((mutationsList) => {
      for (const mutation of mutationsList) {
         if (mutation.type === "childList") {
            const addedElements = mutation.addedNodes
            addedElements.forEach((element) => {
               if (element instanceof HTMLElement) {
                  const textElements = element.querySelectorAll(
                     ":not(iframe):not(script):not(style):not([class*=glow]) :not(:empty):not(:has(*))"
                  )
                  textElements.forEach((textElement) => {
                     applyGlowEffectToElement(textElement as HTMLElement)
                  })
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
}

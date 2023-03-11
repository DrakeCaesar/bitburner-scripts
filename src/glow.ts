import { NS } from "@ns"

export async function main(ns: NS): Promise<void> {
   // Define the CSS class for the glow effect
   const glowClass = "glow"

   // Define the styles for the glow effect
   const glowStyles = `
    text-shadow: 0 0 5px rgba(255, 255, 255, 0.5);
`

   // Function to apply the glow effect to a given text element
   function applyGlowEffectToElement(element: HTMLElement) {
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

import { NS } from "@ns"

export async function main(ns: NS): Promise<void> {
   // Define the CSS class for the glow effect
   const glowClass = "glow"

   // Define the styles for the glow effect
   const glowStyles = `
    text-shadow: 0 0 10px currentColor;
    animation: glow 1s ease-in-out infinite alternate;
    
    @keyframes glow {
        from {
            text-shadow: 0 0 10px currentColor;
        }
        to {
            text-shadow: 0 0 20px currentColor;
        }
    }
`

   // Function to apply the glow effect to a given text element
   function applyGlowEffectToElement(element: HTMLElement) {
      const color = getComputedStyle(element).color
      element.classList.add(glowClass)
      element.style.color = "transparent"
      element.style.webkitTextFillColor = color
      element.style.webkitTextStrokeWidth = "1px"
      element.style.webkitTextStrokeColor = color
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

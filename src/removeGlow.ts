export async function main(): Promise<void> {
  const doc: Document = eval("document")
  const glowClass = "glow"

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

  removeGlowFromAllElements()
  stopObservingMutations()
}

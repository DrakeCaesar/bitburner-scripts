function applyGlowEffectToProgressBar() {
   const selector = ".MuiLinearProgress-bar"
   const boxShadowStyle = "0 0 10px 2px white"
   const elements = document.querySelectorAll(selector)
   elements.forEach((element) => {
      element.style.boxShadow = boxShadowStyle
      let parent = element.parentElement
      while (parent) {
         parent.style.overflow = "visible"
         parent = parent.parentElement
      }
      const transform = getComputedStyle(element).transform
      const translateXRegex = /([-0-9]+.[0-9]+)/
      const translateX = parseFloat(transform.match(translateXRegex))
      if (translateX) {
         // Update the width with the same amount as the translateX value
         const widthValue = element.offsetWidth + translateX
         element.style.width = `${widthValue}px`
         element.style.transform = ""
         element.style.transition = "none"
      }
   })
}

applyGlowEffectToProgressBar() // call the function on page load

const observer = new MutationObserver(function (mutationsList, observer) {
   for (let mutation of mutationsList) {
      if (
         mutation.type === "attributes" &&
         mutation.attributeName === "style"
      ) {
         applyGlowEffectToProgressBar() // call the function when style attribute changes
      }
   }
})

observer.observe(document.body, { attributes: true, subtree: true }) // observe for style changes

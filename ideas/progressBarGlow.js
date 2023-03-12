const selector = ".MuiLinearProgress-bar"
const boxShadowStyle = "0 0 10px 2px white"
const elements = document.querySelectorAll(selector)

const observer = new MutationObserver((mutationsList, observer) => {
   for (let mutation of mutationsList) {
      if (
         mutation.type === "attributes" &&
         mutation.attributeName === "style"
      ) {
         const element = mutation.target
         const transform = getComputedStyle(element).transform
         const translateXRegex = /([-0-9]+.[0-9]+)/
         const translateX = -parseFloat(transform.match(translateXRegex))

         if (translateX) {
            const translateXValue = translateX[1]
            // Update the width with the same amount as the translateX value
            const widthValue = element.offsetWidth - translateXValue
            element.style.width = `${widthValue}px`
            element.style.transform = ""
            element.style.transition = "none"
         }
      }
   }
})

elements.forEach((element) => {
   element.style.boxShadow = boxShadowStyle
   let parent = element.parentElement
   while (parent) {
      parent.style.overflow = "visible"
      parent = parent.parentElement
   }
   observer.observe(element, { attributes: true })
})

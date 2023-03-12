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
   console.log(getComputedStyle(element).transform)
   const translateXValue = -parseFloat(transform.match(translateXRegex)[1])

   console.log(transform)
   console.log(translateXValue)

   // Update the width with the same amount as the translateX value
   const widthValue = element.offsetWidth - translateXValue
   element.style.width = `${widthValue}px`
   element.style.transform = ""
})

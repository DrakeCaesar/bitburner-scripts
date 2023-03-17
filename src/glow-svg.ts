export async function main(): Promise<void> {
   // Function to calculate the luminance value of a given color
   function calculateLuminance(color: string): number {
      const rgb = color.substring(4, color.length - 1).split(",")
      const r = parseInt(rgb[0].trim(), 10) / 255
      const g = parseInt(rgb[1].trim(), 10) / 255
      const b = parseInt(rgb[2].trim(), 10) / 255
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
   }

   // Function to apply the glow effect to an SVG element
   function applyGlowEffectToSvgElement(element: SVGElement) {
      const color = getComputedStyle(element).fill
      const luminance = calculateLuminance(color)
      const opacity = luminance * 0.6
      const filter = document.createElementNS(
         "http://www.w3.org/2000/svg",
         "filter"
      )
      filter.setAttribute("id", "glow-filter")
      const feDropShadow = document.createElementNS(
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
      element.style.padding = "10px"
      element.style.margin = "-10px"
   }

   // Apply the glow effect to all SVG elements on page load
   const svgElements = document.querySelectorAll("svg")
   svgElements.forEach(function (svgElement) {
      applyGlowEffectToSvgElement(svgElement)
   })
}

import { NS } from "@ns"

let processedParagraphs: NodeListOf<HTMLParagraphElement>

export async function main(ns: NS) {
  ns.tprint("Hello World!")

  // Find all paragraphs on the page
  const paragraphs = document.querySelectorAll(".jss1.MuiBox-root.css-0 > p")

  // Pass list to later defined function
  passToFunction(paragraphs as NodeListOf<HTMLParagraphElement>)

  // Initialize processedParagraphs variable for mutation observer
  processedParagraphs = paragraphs as NodeListOf<HTMLParagraphElement>

  // Add mutation observer
  const mutationObserver = new MutationObserver(() => {
    const newParagraphs = document.querySelectorAll(".jss1.MuiBox-root.css-0 > p")
    if (newParagraphs.length !== processedParagraphs.length) {
      passToFunction(newParagraphs as NodeListOf<HTMLParagraphElement>)
      processedParagraphs = newParagraphs as NodeListOf<HTMLParagraphElement>
    }
  })
  mutationObserver.observe(document, { childList: true, subtree: true })
}

function passToFunction(paragraphs: NodeListOf<HTMLParagraphElement>) {
  // Loop through each paragraph element
  paragraphs.forEach((p) => {
    p.style.lineHeight = "normal"
    // Split the text into parts between brackets
    const parts = p.innerHTML?.split(/\[([^[\]]*?)\]/g) || [p.innerHTML]
    // Map over the parts and replace characters in non-bracket parts
    const replacedParts = parts.map((part, i) => {
      if (i % 2 === 0) {
        // Check if part is outside of brackets
        return part!
          .replaceAll("/", "╱")
          .replaceAll("<╱", "</")
          .replaceAll("\\", "╲")
          .replaceAll("-", "─")
          .replaceAll("|", "│")
          .replaceAll("+", "┼")
        //.replaceAll("o", "◯")
      }
      return "[" + part + "]" // If part is inside brackets, just return it as-is
    })
    // Join the parts back together and update the paragraph's innerHTML
    p.innerHTML = replacedParts.join("")
  })
}

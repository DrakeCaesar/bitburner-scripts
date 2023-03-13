import { NS } from "@ns"

function replaceLegacyProgressBars(node: Node) {
   if (node.nodeType === Node.TEXT_NODE) {
      // If the node is a text node, replace any legacy progress bars in the text content
      if (node.textContent) {
         const content = node.textContent
         const matches = content.match(/(\[[|]+|[-]+\])/g)
         if (matches) {
            for (const oldBar of matches) {
               let newBar = oldBar.replace("[|", "")
               newBar = newBar.replace("|]", "")
               newBar = newBar.replaceAll("-", "")
               newBar = newBar.replaceAll("|", "")
               newBar = newBar.replaceAll("[", "")
               newBar = newBar.replaceAll("]", "")
               node.textContent = node.textContent.replace(oldBar, newBar)
            }
         }
      }
   } else {
      // If the node is an element, recurse through its children
      for (const childNode of node.childNodes) {
         replaceLegacyProgressBars(childNode)
      }
   }
}
export async function main(ns: NS): Promise<void> {
   const doc = eval("document")

   // Replace any legacy progress bars on the page
   replaceLegacyProgressBars(doc.body)

   // Observe mutations to the page and replace any legacy progress bars that are added
   const observer = new MutationObserver((mutationsList) => {
      for (const mutation of mutationsList) {
         if (mutation.type === "childList") {
            const addedNodes = mutation.addedNodes
            for (const addedNode of addedNodes) {
               replaceLegacyProgressBars(addedNode)
            }
         }
      }
   })

   observer.observe(doc.body, { childList: true, subtree: true })
}

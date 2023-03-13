import { NS } from "@ns"

function generateNewProgressBar(bars: number, dashes: number): string | null {
   const totalSegments = bars + dashes + 2
   if (totalSegments == 2) return null
   const percentage = bars / (bars + dashes)
   const filledSegments = Math.round(totalSegments * percentage)
   const emptySegments = totalSegments - filledSegments
   return (
      (filledSegments
         ? "" + "".repeat(Math.min(filledSegments - 1, totalSegments - 2))
         : "") +
      (emptySegments
         ? "".repeat(Math.min(emptySegments - 1, totalSegments - 2)) + ""
         : "")
   )
}

function generateOldProgressBar(bars: number, dashes: number): string {
   return "[" + "|".repeat(bars) + "-".repeat(dashes) + "]"
}

function replaceOldProgressBars(node: Node) {
   if (node.nodeType === Node.TEXT_NODE) {
      // If the node is a text node, replace any legacy progress bars in the text content
      if (node.textContent) {
         const content = node.textContent
         //ns.tprint("content: " + content)
         const matches = content.matchAll(/\[([|]*)([-]*)\]/g)
         if (matches) {
            for (const oldBar of matches) {
               if (oldBar.length != 3) return
               const bars = oldBar[1].length ?? 0
               const dashes = oldBar[2].length ?? 0
               const newBar = generateNewProgressBar(bars, dashes)
               if (newBar)
                  node.textContent = node.textContent.replace(oldBar[0], newBar)
               // node.textContent =
               //    node.textContent +
               //    "\n" +
               //    node.textContent.replace(oldBar[0], newBar)
            }
         }
      }
   } else {
      // If the node is an element, recurse through its children
      for (const childNode of node.childNodes) {
         replaceOldProgressBars(childNode)
      }
   }
}
export async function main(ns: NS): Promise<void> {
   const size = 30
   for (let bars = 0; bars <= size; bars++) {
      ns.tprint(generateOldProgressBar(bars, size - bars))
      ns.tprint(generateNewProgressBar(bars, size - bars))
   }
   return

   const doc = eval("document")

   // Replace any legacy progress bars on the page
   replaceOldProgressBars(doc.body)

   // Observe mutations to the page and replace any legacy progress bars that are added
   const observer = new MutationObserver((mutationsList) => {
      for (const mutation of mutationsList) {
         if (mutation.type === "childList") {
            const addedNodes = mutation.addedNodes
            for (const addedNode of addedNodes) {
               replaceOldProgressBars(addedNode)
            }
         }
      }
   })

   observer.observe(doc.body, { childList: true, subtree: true })
}

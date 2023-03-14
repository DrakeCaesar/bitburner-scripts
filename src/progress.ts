import { NS } from "@ns"

function generateNewProgressBar(bars: number, dashes: number): string | null {
   const size = bars + dashes
   if (size == 0) return null
   const bar =
      (bars ? "" + "".repeat(Math.min(bars - 1, size - 2)) : "") +
      (dashes ? "".repeat(Math.min(dashes - 1, size - 2)) + "" : "")
   const expansion = ((size + 2) / size) * 100
   return `<span class="expanded" style="display: inline-block; width: ${expansion}%;">${bar}</span>`
}

function generateOldProgressBar(bars: number, dashes: number): string {
   return "[" + "|".repeat(bars) + "-".repeat(dashes) + "]"
}

// if (words.length > 1 && !paragraphs[i].querySelector("span.expanded")) {
//    words[1] = `<span class="expanded" style="display: inline-block; width: 120%;">${words[1]}</span>`
//    paragraphs[i].innerHTML = words.join(" ")
// }

function replaceOldProgressBars(node: Node) {
   if (node instanceof HTMLParagraphElement) {
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
               if (newBar) {
                  //node.textContent = node.textContent.replace(oldBar[0], newBar)
                  const newContent = node.textContent.replace(oldBar[0], newBar)
                  //const newSpan = document.createElement("span")
                  node.innerHTML = newContent
                  node.style.whiteSpace = "pre"

                  // Replace the original text node with the new span element
                  // if (node.parentNode?.firstChild instanceof Element)
                  //    node.parentNode?.replaceChild(
                  //       newSpan,
                  //       node.parentNode.firstChild
                  //    )
               }
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
   //return

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

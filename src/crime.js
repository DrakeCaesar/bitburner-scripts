const doc = eval("document")

/** @param {import("..").NS } ns */
export async function main(ns) {
   const crimeText = ns.args[0]
   if (!isString(crimeText)) {
      throw "First argument should be a string."
   }
   const count = ns.args[1] > 0 ? ns.args[1] : Infinity
   getCity().click()
   getSlums().click()
   for (var i = 0; i < count; ++i) {
      const crime = getCrime(crimeText)
      if (crime == null) {
         ns.toast(
            "Abort: cannot find element containing textContent: " +
               crimeText +
               ".",
            "error"
         )
         return
      }
      const handler = Object.keys(crime)[1]
      crime[handler].onClick({ isTrusted: true })
      //ns.singularity.getCrimeStats("crimeText").time
      while (getCancelCrime() != null) {
         if (getTimeRemaining() == "1 seconds") {
            const backdrop = doc.getElementsByClassName("MuiBackdrop-root")[0]
            if (backdrop != null) {
               backdrop.click()
            }
         }
         await ns.sleep(1000)
      }
   }
   ns.toast("Crime spree concluded.", "info")
}

function getCity() {
   for (const elem of doc.querySelectorAll("p")) {
      if (elem.textContent == "City") {
         return elem
      }
   }
}

function getSlums() {
   return doc.querySelector("[aria-label='The Slums']")
}

function getCrime(text) {
   for (const elem of doc.querySelectorAll("button")) {
      if (elem.textContent.toLowerCase().includes(text.toLowerCase())) {
         return elem
      }
   }
}

function getCancelCrime() {
   for (const elem of doc.querySelectorAll("button")) {
      if (elem.textContent.includes("Cancel crime")) {
         return elem
      }
   }
}

function getTimeRemaining() {
   for (const elem of doc.querySelectorAll("p")) {
      if (elem.textContent.includes("Time remaining:")) {
         const text = elem.textContent
         return text.substring(text.indexOf(":") + 2, text.indexOf("["))
      }
   }
}

function isString(x) {
   return Object.prototype.toString.call(x) === "[object String]"
}

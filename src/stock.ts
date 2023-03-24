import { NS } from "@ns"

interface StockData {
   symbol: string
   prices: number[]
}

export async function main(ns: NS) {
   // Get list of symbols for all stocks
   const symbols: string[] = ns.stock.getSymbols()

   // Create canvas element and context
   const canvas = document.createElement("canvas")
   canvas.width = window.innerWidth
   canvas.height = window.innerHeight
   document.body.appendChild(canvas)
   const context = canvas.getContext("2d")

   // Set canvas size and margins
   const width = canvas.width
   const height = canvas.height
   const margin = { top: 20, right: 20, bottom: 20, left: 50 }
   const chartWidth = width - margin.left - margin.right
   const chartHeight = height - margin.top - margin.bottom

   // Create data array for chart
   const data: StockData[] = symbols.map((symbol) => ({ symbol, prices: [] }))

   // Set up x and y domains
   const xDomain: [number, number] = [0, 60000]
   const yDomain: [number, number] = [0, ns.stock.getPrice(symbols[0])]

   // Update chart with new data every second
   while (true) {
      const time = new Date()
      const prices: number[] = symbols.map((symbol) =>
         ns.stock.getPrice(symbol)
      )
      const hasChanged = prices.some(
         (price, i) => data[i].prices[data[i].prices.length - 1] !== price
      )
      if (!hasChanged) {
         // Sleep for one second and continue
         await ns.sleep(1000)
         continue
      }
      const test = ns.hacknet

      prices.forEach((price, i) => data[i].prices.push(price))

      // Update x and y domains
      xDomain[0] = time.getTime() - 60000
      xDomain[1] = time.getTime()
      yDomain[1] = Math.max(...prices)

      // Clear chart
      if (context == null) return
      context.clearRect(0, 0, width, height)

      // Draw x and y axes
      context.beginPath()
      context.moveTo(margin.left, margin.top + chartHeight)
      context.lineTo(margin.left + chartWidth, margin.top + chartHeight)
      context.moveTo(margin.left, margin.top)
      context.lineTo(margin.left, margin.top + chartHeight)
      context.stroke()

      // Draw line for each stock
      data.forEach((d, i) => {
         // Compute scales for x and y axes
         const xScale = (x: number) =>
            margin.left +
            ((x - xDomain[0]) * chartWidth) / (xDomain[1] - xDomain[0])
         const yScale = (y: number) =>
            margin.top +
            chartHeight -
            ((y - yDomain[0]) * chartHeight) / (yDomain[1] - yDomain[0])
         context.beginPath()
         context.strokeStyle = [
            "red",
            "green",
            "blue",
            "orange",
            "purple",
            "yellow",
         ][i % 6]
         context.lineWidth = 2
         context.lineJoin = "round"
         context.lineCap = "round"
         d.prices.forEach((price, j) => {
            const x = xScale(time.getTime() - 60000 + j * 1000)
            const y = yScale(price)
            if (j === 0) {
               context.moveTo(x, y)
            } else {
               context.lineTo(x, y)
            }
         })
         context.stroke()
      })
      // Sleep for one second

      await ns.sleep(1000)
   }
}

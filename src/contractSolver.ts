import { NS } from "@ns"

export async function main(ns: NS): Promise<void> {
   const knownServers: string[] = []
   crawl(ns, knownServers)
   let solutions = ""
   const dict: Record<string, [string, string][]> = {}
   const timeDict: Record<string, number[]> = {}
   const solve = ns.args[0]
   const grep = ns.args[1]

   let totalC = 0
   let solvableC = 0

   for (const hostname of knownServers) {
      const listCCT = ns.ls(hostname, ".cct")

      if (listCCT.length) {
         totalC += listCCT.length
         for (const contract of listCCT) {
            const type = ns.codingcontract.getContractType(contract, hostname)
            const data = ns.codingcontract.getData(contract, hostname)

            const start = performance.now()
            const answer = getAnswer(ns, contract, hostname)
            const end = performance.now()

            if (answer != null && answer != undefined) {
               solutions += "hostname: " + hostname + "\n"
               solutions += "contract: " + contract + "\n"
               solutions += "type:     " + type + "\n"
               solutions += "data:     " + data + "\n"
               solutions += "answer:   " + String(answer) + "\n"

               solvableC++

               let reward
               if (solve) {
                  reward = ns.codingcontract.attempt(answer, contract, hostname)
                  solutions += "reward:   " + reward + "\n"
               }
               solutions += "\n"
               if (!(type in timeDict)) {
                  timeDict[type] = []
               }
               timeDict[type].push(end - start)
            } else {
               if (!(type in dict)) {
                  dict[type] = []
               }
               dict[type].push([hostname, contract])
            }
         }
      }
   }

   let contractTypes
   const keys = Object.keys(dict).sort()

   if (keys.length) {
      contractTypes = "\nUnknown Types:\n\n"
      for (const item of keys) {
         contractTypes += item + "\n"
         if (grep) {
            for (const element of dict[item.trim()]) {
               if (
                  element[1]
                     .toLowerCase()
                     .includes(grep.toString().toLowerCase())
               ) {
                  contractTypes +=
                     "   " + element[0].padEnd(20) + element[1] + "\n"
               }
            }
         }
      }
      contractTypes += "\n"
   }
   if (solutions) {
      //ns.tprintf("Solutions:\n\n" + solutions)
   }

   if (contractTypes) {
      ns.tprintf(contractTypes)
   }

   ns.tprintf("Total:    " + totalC)
   ns.tprintf("Solvable: " + solvableC)

   let totalTime = 0

   const sortedRecord = Object.fromEntries(
      Object.entries(timeDict).sort((a, b) => {
         const avgA = a[1].reduce((acc, curr) => acc + curr, 0) / a[1].length
         const avgB = b[1].reduce((acc, curr) => acc + curr, 0) / b[1].length
         return avgB - avgA
      })
   )

   contractTypes = "\nAverage execution time:\n\n"
   for (const [key, value] of Object.entries(sortedRecord)) {
      contractTypes += key.padEnd(40) + avg(value) + "\n"
      totalTime += sum(value)
   }
   contractTypes += "\n"

   if (contractTypes) {
      ns.tprintf(contractTypes)
   }

   ns.tprintf("Total execution time:".padEnd(40) + totalTime)
}

function crawl(ns: NS, servers: string[]) {
   const scanned = new Set<string>()
   const queue = ["home"]
   while (queue.length > 0) {
      const curr = queue.shift()
      if (!curr || scanned.has(curr)) {
         continue
      }
      scanned.add(curr)
      if (curr !== "home") {
         servers.push(curr)
      }
      const neighbors = ns.scan(curr)
      for (const neighbor of neighbors) {
         queue.push(neighbor)
      }
   }
}

function sum(numbers: number[]) {
   return numbers.reduce((a, b) => a + b, 0)
}

function avg(numbers: number[]): number {
   if (numbers.length === 0) {
      return 0
   }
   const total = numbers.reduce((a, b) => a + b)
   return total / numbers.length
}

function getAnswer(ns: NS, contract: string, hostname: string) {
   const type = ns.codingcontract.getContractType(contract, hostname)
   const data = ns.codingcontract.getData(contract, hostname)

   let answer
   switch (type) {
      case "Subarray with Maximum Sum":
         answer = subarrayWithMaximumSum(data)
         break
      case "Unique Paths in a Grid I":
         answer = uniquePathsInAGridI(data)
         break
      case "Unique Paths in a Grid II":
         answer = uniquePathsInAGridII(data)
         break
      case "Find Largest Prime Factor":
         answer = findLargestPrimeFactor(data)
         break
      case "Sanitize Parentheses in Expression":
         answer = sanitizeParenthesesInExpression(data)
         break
      case "Merge Overlapping Intervals":
         answer = mergeOverlappingIntervals(data)
         break
      case "Algorithmic Stock Trader I":
         answer = stockTrader(1, data)
         break
      case "Algorithmic Stock Trader II":
         answer = stockTrader(data.length, data)
         break
      case "Algorithmic Stock Trader III":
         answer = stockTrader(2, data)
         break
      case "Algorithmic Stock Trader IV":
         answer = stockTrader(data[0], data[1])
         break
      case "Total Ways to Sum II":
         answer = totalWaysToSumII(data[0], data[1])
         answer = null
         break
      case "Generate IP Addresses":
         answer = findIPs(data)
         break
      case "Total Ways to Sum":
         answer = waysToSum(data)
         break
      case "Spiralize Matrix":
         answer = spiralize(data)
         break
      case "Shortest Path in a Grid":
         answer = shortestPath(data)
         break
      case "Minimum Path Sum in a Triangle":
         answer = trianglePath(data)
         break
      case "Array Jumping Game":
         answer = jumpingGame(data)
         break
      case "Array Jumping Game II":
         answer = jumpingGame(data)
         break
      case "Find All Valid Math Expressions":
         //answer = findAllValidMathExpressions(data)
         break
      default:
         break
   }

   return answer
}

function uniquePathsInAGridI(data: number[]): number {
   const w = data[0]
   const h = data[1]

   const arr: number[][] = []
   for (let i = 0; i < w; i++) {
      arr[i] = []
      for (let j = 0; j < h; j++) {
         arr[i][j] = 0
         if (i == 0 || j == 0) {
            arr[i][j] = 1
         } else {
            arr[i][j] = arr[i - 1][j] + arr[i][j - 1]
         }
      }
   }

   const answer: number = arr[w - 1][h - 1]
   return answer
}

function uniquePathsInAGridII(data: string[][]): number {
   const w = data.length
   const h = data[0].length

   const arr: number[][] = []
   for (let i = 0; i < w; i++) {
      arr[i] = []
      for (let j = 0; j < h; j++) {
         if (i == 0 && j == 0) {
            arr[i][j] = 1
         } else if (data[i][j] == "1") {
            arr[i][j] = 0
         } else if (i == 0) {
            arr[i][j] = arr[i][j - 1]
         } else if (j == 0) {
            arr[i][j] = arr[i - 1][j]
         } else {
            arr[i][j] = arr[i - 1][j] + arr[i][j - 1]
         }
      }
   }

   const answer: number = arr[w - 1][h - 1]
   return answer
}

function subarrayWithMaximumSum(data: number[]) {
   let answer = Number.MIN_SAFE_INTEGER
   let cur = 0
   for (let i = 0; i < data.length; i++) {
      cur = cur + data[i]
      if (answer < cur) {
         answer = cur
      }
      if (cur < 0) {
         cur = 0
      }
   }

   return answer
}

function findLargestPrimeFactor(data: number) {
   const factors = []
   let d = 2
   while (data > 1) {
      while (data % d == 0) {
         factors.push(d)
         data /= d
      }
      d = d + 1
      if (d * d > data) {
         if (data > 1) factors.push(data)
         break
      }
   }
   const answer = Math.max(...factors)
   return answer
}
function sanitizeParenthesesInExpression(str: string): string[] {
   const isValid = (str: string): boolean => {
      let count = 0
      for (let i = 0; i < str.length; i++) {
         if (str[i] === "(") count++
         if (str[i] === ")") count--
         if (count < 0) return false
      }
      return count === 0
   }

   const result: string[] = []
   let leftToRemove = 0
   let rightToRemove = 0

   for (let i = 0; i < str.length; i++) {
      if (str[i] === "(") {
         leftToRemove++
      } else if (str[i] === ")") {
         if (leftToRemove > 0) {
            leftToRemove--
         } else {
            rightToRemove++
         }
      }
   }

   const removeParentheses = (
      str: string,
      index: number,
      leftRemoved: number,
      rightRemoved: number
   ): void => {
      if (leftRemoved === leftToRemove && rightRemoved === rightToRemove) {
         if (isValid(str)) {
            result.push(str)
         }
         return
      }
      for (let i = index; i < str.length; i++) {
         if (i > index && str[i] === str[i - 1]) continue
         if (str[i] === "(" && leftRemoved < leftToRemove) {
            removeParentheses(
               str.slice(0, i) + str.slice(i + 1),
               i,
               leftRemoved + 1,
               rightRemoved
            )
         }
         if (str[i] === ")" && rightRemoved < rightToRemove) {
            removeParentheses(
               str.slice(0, i) + str.slice(i + 1),
               i,
               leftRemoved,
               rightRemoved + 1
            )
         }
      }
   }

   removeParentheses(str, 0, 0, 0)

   return result
}

/*
function Merge_Overlapping_Intervals(data) {
    ns.tprint(data)
    data.sort(function (first, second) {
        return first[1] - second[1] || first[0] - second[0]
    })
    ns.tprint(data)

    let length = data.length - 1
    for (let i = 0; i < length; i++) {
        ns.tprint(data[i])

        if (data[i][1] >= data[i + 1][0]) {
            data[i][1] = data[i + 1][1]
            data.splice(i + 1, i + 1)
            length--
        }
    }
    return data
}
*/

function mergeOverlappingIntervals(data: number[][]) {
   const map = []
   let start = Number.MAX_SAFE_INTEGER
   for (const [first, second] of data) {
      start = Math.min(start, first)
      for (let i = first; i <= second; i++) {
         map[i * 2] = i
         if (i != second) {
            map[i * 2 + 1] = true
         }
      }
   }
   map.push(null)
   const answer = []
   let last = false
   const temp = []
   for (let i = start; i < map.length; i++) {
      if (map[i * 2] && last == false) {
         temp[0] = map[i * 2]
         last = true
      } else if (
         (map[i * 2] == null || map[i * 2 - 1] == null) &&
         last == true
      ) {
         temp[1] = map[(i - 1) * 2]

         last = false
         answer.push([temp[0], temp[1]])

         if (map[i * 2 - 1] == null && map[i * 2]) {
            i--
         }
      }
   }

   return answer
}

function stockTrader(k: number, prices: number[]) {
   if (prices.length < 2 || k === 0) {
      return 0
   }

   if (k >= prices.length / 2) {
      let maxProfit = 0
      for (let i = 1; i < prices.length; i++) {
         if (prices[i] > prices[i - 1]) {
            maxProfit += prices[i] - prices[i - 1]
         }
      }
      return maxProfit
   }

   const dp = Array.from({ length: k + 1 }, () =>
      Array.from({ length: prices.length }, () => 0)
   )

   for (let i = 1; i <= k; i++) {
      let maxDiff = -prices[0]
      for (let j = 1; j < prices.length; j++) {
         dp[i][j] = Math.max(dp[i][j - 1], prices[j] + maxDiff)
         maxDiff = Math.max(maxDiff, dp[i - 1][j - 1] - prices[j])
      }
   }

   return dp[k][prices.length - 1]
}

function totalWaysToSumII(n: number, numbers: number[]): number {
   const dp = Array(2).fill(0)
   dp[0] = 1

   for (let i = 1; i <= n; i++) {
      dp[i % 2] = 0
      for (const num of numbers) {
         if (i - num >= 0) {
            dp[i % 2] += dp[(i - num) % 2]
         }
      }
   }

   return dp[n % 2]
}

function findIPs(str: string) {
   const result: string[] = []

   const backtrack = (startIndex: number, parts: string[]) => {
      if (parts.length === 4 && startIndex === str.length) {
         result.push(parts.join("."))
         return
      }

      if (parts.length === 4 || startIndex === str.length) {
         return
      }

      // Optimization: check remaining length against maximum part length
      const maxRemainingLength = (4 - parts.length) * 3
      const remainingLength = str.length - startIndex
      if (remainingLength > maxRemainingLength) {
         return
      }

      for (let i = startIndex; i < str.length; i++) {
         const part = str.substring(startIndex, i + 1)
         if (
            (part.length > 1 && part.startsWith("0")) ||
            parseInt(part) > 255
         ) {
            break
         }

         parts.push(part)
         backtrack(i + 1, parts)
         parts.pop()
      }
   }

   backtrack(0, [])
   return result
}

function waysToSum(data: number) {
   const arr = new Array(data + 1).fill(0)
   arr[0] = 1
   for (let i = 1; i < data + 1; i++)
      for (let j = 1; j < data + 1; j++)
         if (j >= i) arr[j] = arr[j] + arr[j - i]

   return arr[data] - 1
}

function spiralize(data: (number | null)[][]) {
   const matrix = data
   const h = matrix.length
   const w = matrix[0].length
   let x = 0
   let y = 0
   const dataCount = h * w
   let count = 0
   const answer = []
   while (count < dataCount) {
      while (x < w - 1 && matrix[y][x + 1]) {
         answer.push(matrix[y][x])
         matrix[y][x] = null
         x++
         if (count++ == dataCount) return answer
      }

      while (y < h - 1 && matrix[y + 1][x]) {
         answer.push(matrix[y][x])
         matrix[y][x] = null
         y++
         if (count++ == dataCount) return answer
      }
      while (x > 0 && matrix[y][x - 1]) {
         answer.push(matrix[y][x])
         matrix[y][x] = null
         x--
         if (count++ == dataCount) return answer
      }
      while (y > 0 && matrix[y - 1][x]) {
         answer.push(matrix[y][x])
         matrix[y][x] = null
         y--
         if (count++ == dataCount) return answer
      }

      if (count == dataCount - 1) {
         answer.push(matrix[y][x])
         matrix[y][x] = null
         return answer
      }
   }
   return null
}

function shortestPath(grid: number[][]) {
   const m = grid.length
   const n = grid[0].length
   const queue = [[0, 0]]
   const visited = new Set<string>()
   visited.add("0,0")
   const parent: { [key: string]: number[] | null } = { "0,0": null }

   const isInsideGrid = (i: number, j: number) =>
      i >= 0 && i < m && j >= 0 && j < n

   const getNeighbors = (i: number, j: number) => {
      const neighbors = []
      if (isInsideGrid(i - 1, j) && grid[i - 1][j] === 0)
         neighbors.push([i - 1, j])
      if (isInsideGrid(i + 1, j) && grid[i + 1][j] === 0)
         neighbors.push([i + 1, j])
      if (isInsideGrid(i, j - 1) && grid[i][j - 1] === 0)
         neighbors.push([i, j - 1])
      if (isInsideGrid(i, j + 1) && grid[i][j + 1] === 0)
         neighbors.push([i, j + 1])
      return neighbors
   }

   while (queue.length > 0) {
      const next = queue.shift()
      if (next) {
         const [i, j] = next
         if (i === m - 1 && j === n - 1) {
            // Target reached, construct path
            const path = []
            let curr: number[] | null = [m - 1, n - 1]
            while (curr !== null) {
               const [i, j]: number[] = curr
               const parentKey: string = i + "," + j
               const parentVal: number[] | null = parent[parentKey]
               if (parentVal !== null) {
                  const [pi, pj] = parentVal
                  if (pi < i) path.unshift("D")
                  else if (pi > i) path.unshift("U")
                  else if (pj < j) path.unshift("R")
                  else if (pj > j) path.unshift("L")
               }
               curr = parentVal
            }
            return path.join("")
         }
         for (const neighbor of getNeighbors(i, j)) {
            const key = neighbor[0] + "," + neighbor[1]
            if (!visited.has(key)) {
               queue.push(neighbor)
               visited.add(key)
               parent[key] = [i, j]
            }
         }
      }
   }

   // No path found
   return ""
}

function trianglePath(data: number[][]) {
   for (let j = 1; j < data.length; j++) {
      for (let i = 0; i < data[j].length; i++) {
         if (i == data[j].length - 1) {
            data[j][i] += data[j - 1][i - 1]
         } else if (i == 0) {
            data[j][i] += data[j - 1][i]
         } else {
            data[j][i] += Math.min(data[j - 1][i], data[j - 1][i - 1])
         }
      }
   }
   return Math.min(...data[data.length - 1])
}

function jumpingGame(numbers: number[]): number {
   const n = numbers.length
   const dp = Array(n).fill(Number.MAX_SAFE_INTEGER)
   dp[0] = 0

   for (let i = 0; i < n; i++) {
      for (let j = i + 1; j <= i + numbers[i] && j < n; j++) {
         dp[j] = Math.min(dp[j], dp[i] + 1)
      }
   }

   return dp[n - 1] === Number.MAX_SAFE_INTEGER ? 0 : dp[n - 1]
}

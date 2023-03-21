/* eslint-disable @typescript-eslint/no-non-null-assertion */
onmessage = (event) => {
   const { type, data } = event.data

   let answer: string | number | unknown[] | null
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
         answer = totalWaysToSumII(data)
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
         answer = findAllValidMathExpressions(data)
         break
      case "Proper 2-Coloring of a Graph":
         answer = proper2Coloring(data)
         break
      case "HammingCodes: Encoded Binary to Integer":
         answer = hammingDecode(data)
         break
      case "HammingCodes: Integer to Encoded Binary":
         answer = hammingEncode(data)
         break
      case "Compression I: RLE Compression":
         answer = RLECompression(data)
         break
      case "Compression II: LZ Decompression":
         answer = LZDecompression(data)
         break
      case "Compression III: LZ Compression":
         answer = LZCompression(data)
         break
      case "Encryption I: Caesar Cipher":
         answer = CaesarCipher(data)
         break
      case "Encryption II: Vigenère Cipher":
         answer = VigenereCipher(data)
         break
      default:
         answer = null
         break
   }

   // Send the response message back to the main thread with the result
   postMessage(answer)
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

function totalWaysToSumII([targetSum, numbers]: [number, number[]]): number {
   const ways: number[] = new Array(targetSum + 1).fill(0)
   ways[0] = 1

   for (const num of numbers) {
      for (let i = num; i <= targetSum; i++) {
         ways[i] += ways[i - num]
      }
   }

   return ways[targetSum]
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

function waysToSum(data: number): number {
   const arr: number[] = new Array(data + 1).fill(0)
   arr[0] = 1
   for (let i = 1; i < data; i++) {
      for (let j = i; j <= data; j++) {
         arr[j] += arr[j - i]
      }
   }
   return arr[data]
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
   return ""
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

function findAllValidMathExpressionsNew(data: [string, number]): string[] {
   const [digits, target] = data
   const result: string[] = []

   function dfs(
      current: (string | number)[],
      idx: number,
      evalResult: number,
      prevOperand: number,
      currentNum: number,
      isMult: boolean
   ): void {
      if (idx === digits.length) {
         if (evalResult === target) {
            result.push(current.join(""))
         }
         return
      }

      const digit = parseInt(digits[idx])
      currentNum = currentNum * 10 + digit

      if (currentNum.toString().length > 1 && digits[idx - 1] === "0") {
         // skip numbers with leading zeros
         return
      }

      const nextIdx = idx + 1

      if (current.length === 0) {
         dfs([currentNum], nextIdx, currentNum, currentNum, 0, false)
      } else {
         dfs(
            [...current, "+", currentNum],
            nextIdx,
            evalResult + currentNum,
            currentNum,
            0,
            false
         )
         dfs(
            [...current, "-", currentNum],
            nextIdx,
            evalResult - currentNum,
            -currentNum,
            0,
            false
         )
         if (!isMult) {
            const multResult = prevOperand * currentNum
            dfs(
               [...current, "*", currentNum],
               nextIdx,
               evalResult - prevOperand + multResult,
               multResult,
               0,
               true
            )
         }
      }
   }

   dfs([], 0, 0, 0, 0, false)
   return result
}

function findAllValidMathExpressions(data: [string, number]): string[] {
   const [digits, target] = data
   const result: string[] = []

   function dfs(
      current: string,
      idx: number,
      evalResult: number,
      prevOperand: number
   ): void {
      if (idx === digits.length) {
         if (evalResult === target) {
            result.push(current)
         }
         return
      }

      const numStr = digits.substring(idx, digits.length)
      for (let i = 1; i <= numStr.length; i++) {
         const num = parseInt(numStr.substring(0, i))
         if (i > 1 && numStr[0] === "0") {
            // skip numbers with leading zeros
            continue
         }

         const nextIdx = idx + i

         if (current === "") {
            dfs(`${num}`, nextIdx, num, num)
         } else {
            dfs(`${current}+${num}`, nextIdx, evalResult + num, num)
            dfs(`${current}-${num}`, nextIdx, evalResult - num, -num)
            dfs(
               `${current}*${num}`,
               nextIdx,
               evalResult - prevOperand + prevOperand * num,
               prevOperand * num
            )
         }
      }
   }

   dfs("", 0, 0, 0)
   return result
}
type Graph = [number, number[][]]

function proper2Coloring(data: Graph): number[] {
   const [vertices, edges] = data
   const adjacencyList = buildAdjacencyList(vertices, edges)
   const colors = new Array<number>(vertices).fill(-1)

   if (isBipartite(adjacencyList, colors)) {
      return colors
   } else {
      return []
   }
}

function buildAdjacencyList(vertices: number, edges: number[][]): number[][] {
   const adjacencyList: number[][] = new Array(vertices)
      .fill(null)
      .map(() => [])

   for (const [u, v] of edges) {
      adjacencyList[u].push(v)
      adjacencyList[v].push(u)
   }

   return adjacencyList
}

function isBipartite(adjacencyList: number[][], colors: number[]): boolean {
   const vertices = adjacencyList.length

   for (let i = 0; i < vertices; i++) {
      if (colors[i] === -1) {
         if (!dfsColoring(i, 0, adjacencyList, colors)) {
            return false
         }
      }
   }

   return true
}

function dfsColoring(
   vertex: number,
   color: number,
   adjacencyList: number[][],
   colors: number[]
): boolean {
   colors[vertex] = color

   for (const neighbor of adjacencyList[vertex]) {
      if (colors[neighbor] === -1) {
         if (!dfsColoring(neighbor, 1 - color, adjacencyList, colors)) {
            return false
         }
      } else if (colors[neighbor] === color) {
         return false
      }
   }

   return true
}

/*

// Test cases
const testCases = [
   ["0", "0000"],
   ["1", "1111"],
   ["2", "111100"],
   ["3", "001111"],
   ["4", "1111000"],
   ["5", "0101101"],
   ["6", "0011110"],
   ["7", "1001011"],
   ["8", "11110000"],
   ["9876012345", "00111001100110011010011111111101000111001"],
]

const badTestCases = [
   ["0", "0100"],
   ["1", "1101"],
   ["2", "101100"],
   ["3", "001011"],
   ["4", "1111010"],
   ["5", "0101100"],
   ["6", "0010110"],
   ["7", "1011011"],
   ["8", "11110100"],
   ["9876012345", "00111001100110011010011111111101000111001"],
   ["9876012345", "00111101100110011010011111111101000111001"],
   ["5951", "10101000000000000001011100111111"],
   ["5951", "10101000000000000001011100111111"],
]


testCases.forEach(([number, encoded]) => {
   const enc = hammingEncode(parseInt(number))
   if (enc !== encoded) {
      console.log(`Encoded for ${number}: ${enc}`)
      console.log(`should be   ${number}: ${encoded}`)
   }
   //console.log(`Encoded for ${number}: ${enc}`)

   const dec = hammingDecode(encoded as string)

   if (dec !== number) {
      console.log(`Expected ${encoded}: ${number}`)
      console.log(`Actual   ${encoded}: ${dec}`)
      console.log()
   }
})

badTestCases.forEach(([number, encoded]) => {
   const dec = hammingDecode(encoded as string)

   if (dec !== number) {
      console.log(`Expected ${encoded}: ${number}`)
      console.log(`Actual   ${encoded}: ${dec}`)
      console.log()
   }
})
*/

function hammingEncode(input: number): string {
   const data = input
      .toString(2)
      .split("")
      .map((b) => Number.parseInt(b))

   let numParityBits = 0
   const dataLength = data.length

   while (dataLength + numParityBits + 1 > 1 << numParityBits) {
      numParityBits++
   }

   const encoding = new Array(numParityBits + dataLength + 1)
   const parityBits = []

   for (let i = 1, j = 0; i < encoding.length; i++) {
      if ((i & (i - 1)) === 0) {
         parityBits.push(i)
         encoding[i] = 0
      } else {
         encoding[i] = data[j++]
      }
   }

   for (let i = 0; i < parityBits.length; i++) {
      let parityValue = 0
      for (let j = parityBits[i]; j < encoding.length; j += parityBits[i] * 2) {
         for (let k = j; k < j + parityBits[i] && k < encoding.length; k++) {
            parityValue ^= encoding[k]
         }
      }
      encoding[parityBits[i]] = parityValue
   }

   let count = 0
   for (let i = 0; i < encoding.length; i++) {
      if (encoding[i] === 1) {
         count++
      }
   }

   const globalParity = count % 2 === 0 ? 0 : 1
   encoding[0] = globalParity

   return encoding.join("")
}

function hammingDecode(encoded: string): string {
   const encoding = encoded.split("").map((b) => Number.parseInt(b))

   const globalParity = encoding[0]
   encoding[0] = 0

   const parityBits = []

   for (let i = 1; i <= encoding.length; i *= 2) {
      parityBits.push(i)
   }

   let errorPosition = 0
   for (let i = 0; i < parityBits.length; i++) {
      let parityValue = 0
      for (let j = parityBits[i]; j < encoding.length; j += parityBits[i] * 2) {
         for (let k = j; k < j + parityBits[i] && k < encoding.length; k++) {
            parityValue ^= encoding[k]
         }
      }
      if (parityValue !== 0) {
         errorPosition += parityBits[i]
      }
   }

   if (errorPosition > 0) {
      encoding[errorPosition] ^= 1
   }

   let count = 0
   for (let i = 0; i < encoding.length; i++) {
      if (encoding[i] === 1) {
         count++
      }
   }

   const newGlobalParity = count % 2 === 0 ? 0 : 1
   if (globalParity !== newGlobalParity) {
      encoding[0] = globalParity
   }

   const decodedData = []
   for (let i = 1, j = 0; i < encoding.length; i++) {
      if ((i & (i - 1)) !== 0) {
         decodedData[j++] = encoding[i]
      }
   }

   return parseInt(decodedData.join(""), 2).toString()
}

function RLECompression(input: string): string {
   let result = ""
   let count = 1

   for (let i = 1; i <= input.length; i++) {
      if (i === input.length || input[i] !== input[i - 1]) {
         if (count === 1) {
            result += "1" + input[i - 1]
         } else if (count < 10) {
            result += count + input[i - 1]
         } else {
            const numChunks = Math.floor(count / 9)
            const remainder = count % 9
            for (let j = 0; j < numChunks; j++) {
               result += "9" + input[i - 1]
            }
            if (remainder > 0) {
               result += remainder + input[i - 1]
            }
         }
         count = 1
      } else {
         count++
      }
   }

   return result
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function set(state: any[][], i: number, j: number, str: string | any[]) {
   if (state[i][j] === undefined || str.length < state[i][j].length)
      state[i][j] = str
}

function LZCompression(str: string): string {
   // state [i][j] contains a backreference of offset i and length j
   // eslint-disable-next-line @typescript-eslint/no-unused-vars
   let cur_state = Array.from(Array(10), (_) => Array(10)),
      new_state,
      tmp_state,
      result
   cur_state[0][1] = "" // initial state is a literal of length 1
   for (let i = 1; i < str.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      new_state = Array.from(Array(10), (_) => Array(10))
      const c = str[i]
      // handle literals
      for (let len = 1; len <= 9; len++) {
         const input = cur_state[0][len]
         if (input === undefined) continue
         if (len < 9)
            set(new_state, 0, len + 1, input) // extend current literal
         else set(new_state, 0, 1, input + "9" + str.substring(i - 9, i) + "0") // start new literal
         for (let offset = 1; offset <= Math.min(9, i); offset++) {
            // start new backreference
            if (str[i - offset] === c)
               set(
                  new_state,
                  offset,
                  1,
                  input + len + str.substring(i - len, i)
               )
         }
      }
      // handle backreferences
      for (let offset = 1; offset <= 9; offset++) {
         for (let len = 1; len <= 9; len++) {
            const input = cur_state[offset][len]
            if (input === undefined) continue
            if (str[i - offset] === c) {
               if (len < 9) set(new_state, offset, len + 1, input)
               // extend current backreference
               else set(new_state, offset, 1, input + "9" + offset + "0") // start new backreference
            }
            set(new_state, 0, 1, input + len + offset) // start new literal
            // end current backreference and start new backreference
            for (
               let new_offset = 1;
               new_offset <= Math.min(9, i);
               new_offset++
            ) {
               if (str[i - new_offset] === c)
                  set(new_state, new_offset, 1, input + len + offset + "0")
            }
         }
      }
      tmp_state = new_state
      new_state = cur_state
      cur_state = tmp_state
   }
   for (let len = 1; len <= 9; len++) {
      let input = cur_state[0][len]
      if (input === undefined) continue
      input += len + str.substring(str.length - len, str.length)
      // noinspection JSUnusedAssignment
      if (result === undefined || input.length < result.length) result = input
   }
   for (let offset = 1; offset <= 9; offset++) {
      for (let len = 1; len <= 9; len++) {
         let input = cur_state[offset][len]
         if (input === undefined) continue
         input += len + "" + offset
         if (result === undefined || input.length < result.length)
            result = input
      }
   }
   return result ?? ""
}

function LZDecompression(data: string) {
   let decoded = ""
   let position = 0
   let chunkType = 1

   while (position < data.length) {
      const length = parseInt(data[position], 10)
      position += 1

      if (chunkType === 1) {
         for (let i = 0; i < length; i++) {
            decoded += data[position]
            position += 1
         }
      } else {
         const reference = parseInt(data[position], 10)
         position += 1

         for (let i = 0; i < length; i++) {
            const refPosition = decoded.length - reference
            decoded += decoded[refPosition]
         }

         // Special case when length is 0
         if (length === 0) {
            position -= 1
         }
      }

      chunkType = 3 - chunkType // Toggle between chunk types 1 and 2
   }

   return decoded
}

function CaesarCipher(data: [string, number]): string {
   const plaintext = data[0]
   const shift = data[1]
   const n = plaintext.length
   let cipherText = ""

   for (let i = 0; i < n; i++) {
      const char = plaintext.charAt(i)
      if (char === " ") {
         cipherText += " "
         continue
      }
      const charCode = char.charCodeAt(0)
      let shiftedCharCode = charCode - shift
      if (shiftedCharCode < 65) {
         shiftedCharCode += 26
      }
      const cipherTextChar = String.fromCharCode(shiftedCharCode)
      cipherText += cipherTextChar
   }

   return cipherText
}

function VigenereCipher(data: [string, string]) {
   const plaintext = data[0]
   const keyword = data[1]
   const n = plaintext.length
   let cipherText = ""

   for (let i = 0; i < n; i++) {
      const plaintextChar = plaintext.charAt(i)
      if (plaintextChar === " ") {
         cipherText += " "
         continue
      }
      const keywordIndex = i % keyword.length
      const keywordChar = keyword.charAt(keywordIndex)
      const row = plaintextChar.charCodeAt(0) - 65
      const col = keywordChar.charCodeAt(0) - 65
      const shiftedCharCode = ((row + col) % 26) + 65
      const cipherTextChar = String.fromCharCode(shiftedCharCode)
      cipherText += cipherTextChar
   }

   return cipherText
}

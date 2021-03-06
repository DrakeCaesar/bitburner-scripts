/* eslint-disable no-unused-vars */
/** @param {import("..").NS } ns */
export async function main(ns) {
    let knownServers = new Array()
    crawl(ns, knownServers)
    let solutions = ""
    let dict = {}
    let solve = ns.args[0]
    let grep = ns.args[1]

    // eslint-disable-next-line no-unused-vars
    for (const hostname of knownServers) {
        let listCCT = ns.ls(hostname, ".cct")

        if (listCCT.length) {
            //ns.tprint(hostname + ":")
            for (const contract of listCCT) {
                const type = ns.codingcontract.getContractType(
                    contract,
                    hostname
                )
                const data = ns.codingcontract.getData(contract, hostname)

                let answer = getAnswer(ns, contract, hostname)
                if (answer != null && answer != undefined) {
                    solutions += "hostname: " + hostname + "\n"
                    solutions += "contract: " + contract + "\n"
                    solutions += "type:     " + type + "\n"
                    solutions += "data:     " + data + "\n"
                    solutions += "answer:   " + String(answer) + "\n"
                    let reward
                    if (solve) {
                        reward = ns.codingcontract.attempt(
                            answer,
                            contract,
                            hostname,
                            {
                                returnReward: true,
                            }
                        )
                        solutions += "reward:   " + reward + "\n"
                    }
                    solutions += "\n"
                } else {
                    if (!(type in dict)) {
                        dict[type] = []
                    }
                    dict[type].push([hostname, contract])
                }
            }
        }
    }
    //ns.tprint(JSON.stringify(dict, null, 4))

    let contractTypes
    let keys = []
    for (const [key] of Object.entries(dict)) {
        keys.push(key + " ")
    }

    keys.sort()

    if (keys) {
        contractTypes = "\nUnknown Types:\n\n"
        for (let item of keys) {
            contractTypes += item + "\n"
            if (grep) {
                for (const element of dict[item.trim()]) {
                    if (element[1].toLowerCase().includes(grep.toLowerCase())) {
                        contractTypes +=
                            "   " + element[0].padEnd(20) + element[1] + "\n"
                    }
                }
            }
        }
        contractTypes += "\n"
    }
    if (solutions) {
        ns.tprintf("Solutions:\n\n" + solutions)
    }

    if (contractTypes) {
        ns.tprintf(contractTypes)
    }
}

/** @param {import("..").NS } ns */
function crawl(ns, knownServers, hostname, depth = 0) {
    let servers = ns.scan(hostname)
    for (const element of servers) {
        if (!knownServers.includes(element)) {
            knownServers.push(element)
            crawl(ns, knownServers, element, depth + 1)
        }
    }
}

/** @param {import("..").NS } ns */
function getAnswer(ns, contract, hostname) {
    const type = ns.codingcontract.getContractType(contract, hostname)
    const data = ns.codingcontract.getData(contract, hostname)
    //ns.tprint(ns, data)

    let answer
    switch (type) {
        case "Subarray with Maximum Sum":
            answer = subarrayWithMaximumSum(ns, data)
            break
        case "Unique Paths in a Grid I":
            answer = uniquePathsInAGridI(ns, data)
            break
        case "Unique Paths in a Grid II":
            answer = uniquePathsInAGridII(ns, data)
            break
        case "Find Largest Prime Factor":
            answer = findLargestPrimeFactor(ns, data)
            break
        case "Sanitize Parentheses in Expression":
            answer = sanitizeParenthesesInExpression(ns, data)
            break
        case "Merge Overlapping Intervals":
            answer = mergeOverlappingIntervals(ns, data)
            break
        case "Algorithmic Stock Trader I":
            //answer = stockTrader(data)
            break
        case "Algorithmic Stock Trader II":
            //answer = stockTrader(ns, data)
            break
        case "Total Ways to Sum II":
            //answer = totalWaysToSumII(ns, data)
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
        case "Array Jumping Game I":
            //answer = jumpingGame(ns, data)
            break
        case "Array Jumping Game II":
            //answer = jumpingGame(ns, data)
            break

        default:
            break
    }
    return answer
}

function uniquePathsInAGridI(ns, data) {
    const w = data[0]
    const h = data[1]

    var arr = []
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

    const answer = arr[w - 1][h - 1]
    return answer
}

function uniquePathsInAGridII(ns, data) {
    const w = data.length
    const h = data[0].length

    var arr = []
    for (let i = 0; i < w; i++) {
        arr[i] = []
        for (let j = 0; j < h; j++) {
            if (i == 0 && j == 0) {
                arr[i][j] = 1
            } else if (data[i][j] == 1) {
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

    const answer = arr[w - 1][h - 1]
    return answer
}

function subarrayWithMaximumSum(ns, data) {
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

function findLargestPrimeFactor(ns, data) {
    let factors = []
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

function sanitizeParenthesesInExpression(ns, data) {
    if (isSanitized(ns, data)) {
        return [data]
    }

    let answer = []
    let list = [[data]]
    for (let i = 0; i < data.length && answer.length == 0; i++) {
        list.push([])
        for (let word of list[i]) {
            for (let j = 0; j < word.length; j++) {
                if (word[j] == ")" || word[j] == "(") {
                    let temp = word.slice(0, j) + word.slice(j + 1)
                    if (isSanitized(ns, temp)) {
                        if (answer.indexOf(temp) === -1) answer.push(temp)
                    }
                    if (list[i + 1].indexOf(temp) === -1) list[i + 1].push(temp)
                }
            }
        }
    }
    if (answer.length) return answer
    return [""]
}

function isSanitized(ns, data) {
    let depth = 0
    for (let i = 0; i < data.length; i++) {
        if (data[i] == "(") {
            ++depth
        } else if (data[i] == ")") {
            --depth
        }
        if (depth < 0) return false
    }
    return depth == 0
}
/*
function Merge_Overlapping_Intervals(ns, data) {
    ns.tprint(ns, data)
    data.sort(function (first, second) {
        return first[1] - second[1] || first[0] - second[0]
    })
    ns.tprint(ns, data)

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

function mergeOverlappingIntervals(ns, data) {
    let map = []
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
    let answer = []
    let last = false
    let temp = []
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

function stockTrader(data, index = 0, holding = false, profit = 0) {
    if (index < data.length - 1) {
        return holding
            ? Math.max(
                  stockTrader(data, index + 1, true, profit),
                  stockTrader(data, index + 1, false, profit + data[index])
              )
            : Math.max(
                  stockTrader(data, index + 1, true, profit - data[index]),
                  stockTrader(data, index + 1, false, profit)
              )
    } else {
        if (holding) {
            return profit + data[index]
        } else {
            return profit
        }
    }
}

function totalWaysToSumII(ns, data) {
    const N = 7 //data[0]
    const arr = [1, 4, 7, 9, 10, 11, 12, 13, 16, 18] // data[1]
    ns.tprint(N)
    ns.tprint(arr)

    let count = new Array(N + 1)
    count.fill(0)
    count[0] = 1
    for (let i = 1; i <= N; i++)
        for (let j = 0; j < arr.length; j++)
            if (i >= arr[j]) count[i] += count[i - arr[j]]
    return count[N]
}

function findIPs(data) {
    let input = String(data)
    let answer = []
    for (let i = 0; i < 256; i++) {
        if (!input.startsWith(i.toString())) continue
        for (let j = 0; j < 256; j++) {
            if (!input.startsWith(i.toString() + j)) continue
            for (let k = 0; k < 256; k++) {
                if (!input.startsWith(i.toString() + j + k)) continue
                for (let l = 0; l < 256; l++) {
                    if (input != i.toString() + j + k + l) continue
                    answer.push(i + "." + j + "." + k + "." + l)
                }
            }
        }
    }
    return answer
}

function waysToSum(data) {
    let arr = new Array(data + 1).fill(0)
    arr[0] = 1
    for (let i = 1; i < data + 1; i++)
        for (let j = 1; j < data + 1; j++)
            if (j >= i) arr[j] = arr[j] + arr[j - i]

    return arr[data] - 1
}

function spiralize(data) {
    let matrix = data
    let h = matrix.length
    let w = matrix[0].length
    let x = 0
    let y = 0
    let dataCount = h * w
    let count = 0
    let answer = []
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
}

function shortestPath(data) {
    var matrix = []
    let cols = data[0].length
    let rows = data.length

    for (var i = 0; i < rows; i++) {
        matrix[i] = Array(cols).fill(Infinity)
    }
    //console.log(matrix)
    let fifo = [[rows - 1, cols - 1]]
    matrix[rows - 1][cols - 1] = 0

    while (fifo.length) {
        let temp = fifo.shift()
        let y = temp[0]
        let x = temp[1]
        //console.log(y + " " + x)
        matrix[y][x] = Math.min(
            matrix[y][x],

            matrix[Math.max(0, y - 1)][x] + 1,
            matrix[y][Math.max(0, x - 1)] + 1,

            matrix[Math.min(data.length - 1, y + 1)][x] + 1,
            matrix[y][Math.min(x + 1, data[0].length - 1)] + 1
        )
        if (y - 1 >= 0 && matrix[y - 1][x] == Infinity && data[y - 1][x] == 0)
            fifo.push([y - 1, x])
        if (y + 1 < rows && matrix[y + 1][x] == Infinity && data[y + 1][x] == 0)
            fifo.push([y + 1, x])

        if (x - 1 >= 0 && matrix[y][x - 1] == Infinity && data[y][x - 1] == 0)
            fifo.push([y, x - 1])
        if (x + 1 < cols && matrix[y][x + 1] == Infinity && data[y][x + 1] == 0)
            fifo.push([y, x + 1])
    }
    /*
    for (let j = 0; j < rows; j++) {
        let string = ""
        for (let i = 0; i < cols; i++) {
            if (matrix[j][i] != Infinity) {
                string += String(matrix[j][i]).padStart(3) + " "
            } else {
                string += "_".padStart(3) + " "
            }
        }
        console.log(string)
    }
    */
    if (matrix[0][0] == Infinity) return ""
    let y = 0
    let x = 0
    let path = ""

    while (y != rows - 1 || x != cols - 1) {
        if (y - 1 >= 0 && matrix[y - 1][x] < matrix[y][x]) {
            y--
            path += "U"
        } else if (y + 1 < rows && matrix[y + 1][x] < matrix[y][x]) {
            y++
            path += "D"
        } else if (x - 1 >= 0 && matrix[y][x - 1] < matrix[y][x]) {
            x--
            path += "L"
        } else if (x + 1 < cols && matrix[y][x + 1] < matrix[y][x]) {
            x++
            path += "R"
        }
    }
    return path
}

function trianglePath(data) {
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
    //console.log(data)

    return Math.min(...data[data.length - 1])
}

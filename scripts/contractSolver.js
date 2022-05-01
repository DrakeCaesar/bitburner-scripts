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
                if (answer) {
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
            answer = SubarrayWithMaximumSum(ns, data)
            break
        case "Unique Paths in a Grid I":
            answer = UniquePathsInAGridI(ns, data)
            break
        case "Unique Paths in a Grid II":
            answer = UniquePathsInAGridII(ns, data)
            break
        case "Find Largest Prime Factor":
            answer = FindLargestPrimeFactor(ns, data)
            break
        case "Sanitize Parentheses in Expression":
            answer = SanitizeParenthesesInExpression(ns, data)
            break
        case "Merge Overlapping Intervals":
            answer = MergeOverlappingIntervals(ns, data)
            break

        default:
            break
    }
    return answer
}

function UniquePathsInAGridI(ns, data) {
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

function UniquePathsInAGridII(ns, data) {
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

function SubarrayWithMaximumSum(ns, data) {
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

function FindLargestPrimeFactor(ns, data) {
    let factors = []
    let d = 2
    while (data > 1) {
        while (data % d == 0) {
            factors.push(d)
            data /= d
        }
        d = d + 1
        if (d * d > data) {
            if (data > 1) factors.push(ns, data)
            break
        }
    }
    const answer = Math.max(...factors)
    return answer
}

function SanitizeParenthesesInExpression(ns, data) {
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

function MergeOverlappingIntervals(ns, data) {
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
    ns.tprint("")
    ns.tprint(data)
    ns.tprint(map)
    ns.tprint(answer)
    ns.tprint("")

    return answer
}

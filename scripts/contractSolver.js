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
                let type = ns.codingcontract.getContractType(contract, hostname)
                let answer = getAnswer(ns, contract, hostname)
                if (answer) {
                    solutions += "contract: " + contract + "\n"
                    solutions += "type:     " + type + "\n"
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

    let answer
    switch (type) {
        case "Subarray with Maximum Sum":
            answer = Subarray_with_Maximum_Sum(data, contract, hostname)
            break
        case "Unique Paths in a Grid I":
            answer = Unique_Paths_in_a_Grid_I(data, contract, hostname)
            break
        case "Unique Paths in a Grid II":
            answer = Unique_Paths_in_a_Grid_II(data, contract, hostname)
            break
        case "Find Largest Prime Factor":
            answer = Find_Largest_Prime_Factor(data, contract, hostname)
            break
        case "Sanitize Parentheses in Expression":
            answer = Sanitize_Parentheses_in_Expression(
                data,
                contract,
                hostname
            )
            break

        default:
            break
    }
    return answer
}

function Unique_Paths_in_a_Grid_I(data) {
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

/** @param {import("..").NS } ns */
function Unique_Paths_in_a_Grid_II(data) {
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
    /*
    ns.tprintf("Answer should be: " + String(answer))
    const reward = ns.codingcontract.attempt(answer, contract, hostname, {
        returnReward: true,
    })
    ns.tprintf("reward is: " + String(reward))
    */
}

/** @param {import("..").NS } ns */
function Subarray_with_Maximum_Sum(data) {
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

/** @param {import("..").NS } ns */
function Find_Largest_Prime_Factor(data) {
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

/** @param {import("..").NS } ns */
function Sanitize_Parentheses_in_Expression(data) {
    /*
    ((aa))(a()())))(()

    remove the minimum number of invalid parentheses in order to validate the string. If there are multiple minimal ways to validate the string, provide all of the possible results. The answer should be provided as an array of strings. If it is impossible to validate the string the result should be an array with only an empty string.

    IMPORTANT: The string may contain letters, not just parentheses. Examples:
    "()())()" -> [()()(), (())()]
    "(a)())()" -> [(a)()(), (a())()]
    ")(" -> [""]
    */
    data = "(a())()"
}

function isSanitized(string) {
    let depth = 0
    string.forEach((element) => {})
}

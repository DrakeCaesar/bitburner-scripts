/** @param {import("../..").NS } ns */
export async function main(ns) {
    const contract = "contract-880806.cct"
    const hostname = "the-hub"
    const data = ns.codingcontract.getData(contract, hostname)
    const w = data.length
    const h = data[0].length

    const arr = makeArray(ns, w, h, data)
    const answer = arr[w - 1][h - 1]
    ns.tprintf("Answer should be: " + String(answer))
    const reward = ns.codingcontract.attempt(answer, contract, hostname, {
        returnReward: true,
    })
    ns.tprintf("reward is: " + String(reward))
}

function makeArray(ns, w, h, data) {
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
    return arr
}

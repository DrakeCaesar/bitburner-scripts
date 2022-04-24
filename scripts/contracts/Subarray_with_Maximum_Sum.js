/** @param {import("../..").NS } ns */
export async function main(ns) {
    const contract = "contract-392366.cct"
    const hostname = "sigma-cosmetics"
    const data = ns.codingcontract.getData(contract, hostname)
    const answer = maxSubArraySum(ns, data)
    ns.tprintf("Answer should be: " + String(answer))
    const reward = ns.codingcontract.attempt(answer, contract, hostname, {
        returnReward: true,
    })
    ns.tprintf("reward is: " + String(reward))
}
function maxSubArraySum(ns, data) {
    let max = Number.MIN_SAFE_INTEGER
    ns.tprintf("Data is: " + String(max))

    let cur = 0
    for (let i = 0; i < data.length; i++) {
        cur = cur + data[i]
        if (max < cur) {
            max = cur
        }
        if (cur < 0) {
            cur = 0
        }
    }
    return max
}

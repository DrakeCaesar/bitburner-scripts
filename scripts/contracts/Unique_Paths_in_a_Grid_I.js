/** @param {import("../..").NS } ns */
export async function main(ns) {
    const contract = "contract-987900.cct"
    const hostname = "harakiri-sushi"
    const data = ns.codingcontract.getData(contract, hostname)
    const arr = makeArray(ns, data[0], data[1])
    const answer = arr[data[0] - 1][data[1] - 1]
    ns.tprintf(answer)
}

function makeArray(ns, w, h) {
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
    return arr
}

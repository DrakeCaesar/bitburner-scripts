const testCases = [
    {
        input: [
            169, 149, 94, 85, 133, 175, 120, 34, 38, 60, 86, 18, 13, 83, 16, 7,
            57, 170,
        ],
        output: 375,
    },
    { input: [175, 19, 129, 66, 85, 140, 78], output: 184 },
    {
        input: [136, 57, 103, 30, 87, 123, 19, 189, 125, 150, 57, 3, 141],
        output: 472,
    },
    {
        input: [
            144, 38, 57, 28, 71, 170, 28, 168, 91, 42, 85, 168, 87, 41, 46, 47,
            16, 26, 113,
        ],
        output: 530,
    },
    { input: [157, 83, 145, 12, 161, 52], output: 211 },
    {
        input: [
            18, 132, 51, 101, 169, 165, 180, 51, 3, 74, 37, 156, 3, 5, 107, 4,
            103, 77, 139, 41, 12, 113, 126, 114, 85, 4, 179, 31, 60, 152, 11,
            16, 53, 72, 103, 182, 159, 185, 118, 162, 148, 93, 175, 103, 36,
            171, 39,
        ],
        output: 1570,
    },
]

for (const testCase of testCases) {
    const actual = maxProfit(
        testCase.input,
        Math.floor(testCase.input.length / 2)
    )
    console.log("expected: " + testCase.output)
    console.log("actual:   " + actual + "\n")
}

function maxProfit(price, k) {
    const n = price.length
    // table to store results of sub-problems
    // profit[t][i] stores maximum profit
    // using at most t transactions up to day
    // i (including day i)
    var profit = Array(k + 1).fill(0)
    for (var j = 0; j < k + 1; j++) {
        profit[j] = Array(n + 1).fill(0)
    }
    // For day 0, you can't earn money
    // irrespective of how many times you trade
    for (j = 0; j <= k; j++) {
        profit[j][0] = 0
    }
    // profit is 0 if we don't do any
    // transaction (i.e. k =0)
    for (j = 0; j <= n; j++) profit[0][j] = 0

    // fill the table in bottom-up fashion
    for (var i = 1; i <= k; i++) {
        var prevDiff = -Number.MAX_VALUE
        for (j = 1; j < n; j++) {
            prevDiff = Math.max(prevDiff, profit[i - 1][j - 1] - price[j - 1])
            profit[i][j] = Math.max(profit[i][j - 1], price[j] + prevDiff)
        }
    }

    return profit[k][n - 1]
}

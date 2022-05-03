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
    const actual = findMax(testCase.input, 0, false, 0)
    console.log(testCase.output)
    console.log(actual)
}

function findMax(data, index = 0, holding = false, profit = 0) {
    if (index < data.length - 1) {
        return holding
            ? Math.max(
                  findMax(data, index + 1, true, profit),
                  findMax(data, index + 1, false, profit + data[index])
              )
            : Math.max(
                  findMax(data, index + 1, true, profit - data[index]),
                  findMax(data, index + 1, false, profit)
              )
    } else {
        if (holding) {
            return profit + data[index]
        } else {
            return profit
        }
    }
}

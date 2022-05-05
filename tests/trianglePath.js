const testCases = [
    {
        input: [[2], [3, 4], [6, 5, 7], [4, 1, 8, 3]],
        output: 11,
    },
    {
        input: [
            [9],
            [9, 6],
            [5, 9, 6],
            [8, 6, 4, 1],
            [5, 3, 2, 2, 6],
            [5, 6, 4, 1, 2, 2],
            [1, 5, 8, 9, 3, 3, 2],
        ],
        output: "",
    },
]

for (const testCase of testCases) {
    //console.log(testCase.input)
    //console.log(testCase.output)
    const actual = trianglePath(testCase.input)
    console.log(actual)
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

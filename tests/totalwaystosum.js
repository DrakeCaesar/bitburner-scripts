const testCases = [
    { input: 4, output: 4 },
    { input: 23, output: 1254 },
    { input: 70, output: 4087967 },
    { input: 34, output: 12309 },
    { input: 81, output: 18004326 },
    { input: 80, output: 15796475 },
    { input: 22, output: 1001 },
]

for (const testCase of testCases) {
    console.log(testCase.input)
    console.log(testCase.output)
    const actual = waysToSum(testCase.input)
    console.log(actual)
}

function waysToSum(data) {
    let arr = new Array(data + 1).fill(0)
    arr[0] = 1
    for (let i = 1; i < data + 1; i++)
        for (let j = 1; j < data + 1; j++)
            if (j >= i) arr[j] = arr[j] + arr[j - i]

    return arr[data] - 1
}

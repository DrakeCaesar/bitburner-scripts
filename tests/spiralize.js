const testCases = [
    {
        input: [1, 2, 3, 6, 9, 8, 7, 4, 5],
        output: [
            [1, 2, 3],
            [4, 5, 6],
            [7, 8, 9],
        ],
    },
    {
        input: [1, 2, 3, 4, 8, 12, 11, 10, 9, 5, 6, 7],
        output: [
            [1, 2, 3, 4],
            [5, 6, 7, 8],
            [9, 10, 11, 12],
        ],
    },
]

for (const testCase of testCases) {
    console.log(testCase.input)
    //console.log(testCase.output)
    const actual = spiralize(testCase.input)
    //console.log(actual)
}

function spiralize(data) {
    let w = Math.ceil(data.length / 2)
    let h
    while (!(data.length % w == 0 && (w % 2 || h % 2))) {
        w--
        h = data.length / w
    }

    console.log("h: " + h)
    console.log("w: " + w)

    var matrix = []
    for (var i = 0; i < w; i++) {
        matrix[i] = new Array(h)
    }
    let x = 0
    let y = 0
    let count = 1
    matrix[x][y] = data[0]
    console.log(JSON.stringify(matrix))
    while (count < data.length) {
        while (x < w && matrix[y][x] == null) {
            matrix[y][x] = data[count]
            if (count++ == data.length) return matrix
            console.log(JSON.stringify(matrix))
            ++x
        }
        --x
        while (y < h && matrix[y][x] == null) {
            matrix[y][x] = data[count]
            if (count++ == data.length) return matrix
            console.log(JSON.stringify(matrix))
            ++y
        }
        --y
        while (x > -1 && matrix[y][x] == null) {
            matrix[y][x] = data[count]
            if (count++ == data.length) return matrix
            console.log(JSON.stringify(matrix))
            --x
        }
        ++x
        while (y > -1 && matrix[y][x] == null) {
            matrix[y][x] = data[count]
            if (count++ == data.length) return matrix
            console.log(JSON.stringify(matrix))
            --y
        }
        ++y
    }
}

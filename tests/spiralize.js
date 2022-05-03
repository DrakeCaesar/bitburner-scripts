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
    //console.log(testCase.input)
    console.log(testCase.output)
    const actual = spiralize(testCase.input)
    console.log(actual)
}

function spiralize(data) {
    let w = Math.ceil(data.length / 2)
    let h
    while (!(data.length % w == 0 && (w % 2 || h % 2))) {
        w--
        h = data.length / w
    }
    var matrix = []
    for (var i = 0; i < h; i++) {
        matrix[i] = new Array(w)
    }
    let x = 0
    let y = 0
    let count = 0
    while (count < data.length) {
        while (x < w - 1 && !matrix[y][x + 1]) {
            matrix[y][x++] = data[count]
            if (count++ == data.length) return matrix
        }

        while (y < h - 1 && !matrix[y + 1][x]) {
            matrix[y++][x] = data[count]
            if (count++ == data.length) return matrix
        }

        while (x > 0 && !matrix[y][x - 1]) {
            matrix[y][x--] = data[count]
            if (count++ == data.length) return matrix
        }
        while (y > 0 && !matrix[y - 1][x]) {
            matrix[y--][x] = data[count]
            if (count++ == data.length) return matrix
        }
        if (count == data.length - 1) {
            matrix[y][x] = data[count]
            return matrix
        }
    }
}

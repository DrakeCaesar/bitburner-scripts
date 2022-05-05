const testCases = [
    {
        input: [
            [0, 1, 0, 0, 0],
            [0, 0, 0, 1, 0],
        ],
        output: "DRRURRD",
    },
    {
        input: [
            [0, 1],
            [1, 0],
        ],
        output: "",
    },
    {
        input: [
            [0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 1, 1, 1, 1, 0],
            [1, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 1, 0, 1, 1, 1, 1, 1, 0],
            [0, 0, 0, 0, 0, 1, 0, 0, 0],
            [1, 1, 1, 1, 1, 0, 0, 0, 1],
            [1, 1, 0, 0, 0, 0, 1, 0, 0],
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
    var matrix = []
    let cols = data[0].length
    let rows = data.length

    for (var i = 0; i < rows; i++) {
        matrix[i] = Array(cols).fill(Infinity)
    }
    //console.log(matrix)
    let fifo = [[rows - 1, cols - 1]]
    matrix[rows - 1][cols - 1] = 0

    while (fifo.length) {
        let temp = fifo.shift()
        let y = temp[0]
        let x = temp[1]
        //console.log(y + " " + x)
        matrix[y][x] = Math.min(
            matrix[y][x],

            matrix[Math.max(0, y - 1)][x] + 1,
            matrix[y][Math.max(0, x - 1)] + 1,

            matrix[Math.min(data.length - 1, y + 1)][x] + 1,
            matrix[y][Math.min(x + 1, data[0].length - 1)] + 1
        )
        if (y - 1 >= 0 && matrix[y - 1][x] == Infinity && data[y - 1][x] == 0)
            fifo.push([y - 1, x])
        if (y + 1 < rows && matrix[y + 1][x] == Infinity && data[y + 1][x] == 0)
            fifo.push([y + 1, x])

        if (x - 1 >= 0 && matrix[y][x - 1] == Infinity && data[y][x - 1] == 0)
            fifo.push([y, x - 1])
        if (x + 1 < cols && matrix[y][x + 1] == Infinity && data[y][x + 1] == 0)
            fifo.push([y, x + 1])
    }
    /*
    for (let j = 0; j < rows; j++) {
        let string = ""
        for (let i = 0; i < cols; i++) {
            if (matrix[j][i] != Infinity) {
                string += String(matrix[j][i]).padStart(3) + " "
            } else {
                string += "_".padStart(3) + " "
            }
        }
        console.log(string)
    }
    */
    if (matrix[0][0] == Infinity) return ""
    let y = 0
    let x = 0
    let path = ""

    while (y != rows - 1 || x != cols - 1) {
        if (y - 1 >= 0 && matrix[y - 1][x] < matrix[y][x]) {
            y--
            path += "U"
        } else if (y + 1 < rows && matrix[y + 1][x] < matrix[y][x]) {
            y++
            path += "D"
        } else if (x - 1 >= 0 && matrix[y][x - 1] < matrix[y][x]) {
            x--
            path += "L"
        } else if (x + 1 < cols && matrix[y][x + 1] < matrix[y][x]) {
            x++
            path += "R"
        }
    }
    return path
}

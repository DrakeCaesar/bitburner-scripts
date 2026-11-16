const testCases = [
  {
    input: [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ],
    output: [1, 2, 3, 6, 9, 8, 7, 4, 5],
  },

  {
    input: [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
    ],
    output: [1, 2, 3, 4, 8, 12, 11, 10, 9, 5, 6, 7],
  },
]

for (const testCase of testCases) {
  console.log(testCase.input)
  console.log(testCase.output)
  const actual = spiralize(testCase.input)
  console.log(actual)
}

function spiralize(data) {
  let matrix = data
  let h = matrix.length
  let w = matrix[0].length
  let x = 0
  let y = 0
  let dataCount = h * w
  let count = 0
  let answer = []
  while (count < dataCount) {
    while (x < w - 1 && matrix[y][x + 1]) {
      answer.push(matrix[y][x])
      matrix[y][x] = null
      x++
      if (count++ == dataCount) return answer
    }

    while (y < h - 1 && matrix[y + 1][x]) {
      answer.push(matrix[y][x])
      matrix[y][x] = null
      y++
      if (count++ == dataCount) return answer
    }
    while (x > 0 && matrix[y][x - 1]) {
      answer.push(matrix[y][x])
      matrix[y][x] = null
      x--
      if (count++ == dataCount) return answer
    }
    while (y > 0 && matrix[y - 1][x]) {
      answer.push(matrix[y][x])
      matrix[y][x] = null
      y--
      if (count++ == dataCount) return answer
    }

    if (count == dataCount - 1) {
      answer.push(matrix[y][x])
      matrix[y][x] = null
      return answer
    }
  }
}

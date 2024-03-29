const testCases = [
  {
    input: [
      16, 171, 74, 18, 34, 182, 173, 19, 128, 36, 43, 124, 27, 163, 69, 154, 34,
      92, 72, 152, 142, 90, 200,
    ],
    output: 347,
  },
  {
    input: [
      44, 44, 107, 100, 21, 189, 116, 158, 111, 166, 160, 168, 151, 57, 187, 3,
      176, 40, 132, 178, 48, 44, 12, 18, 28, 162, 144, 197, 51, 138, 29, 121,
      99, 155, 78, 71, 75, 141, 143,
    ],
    output: 362,
  },
  {
    input: [
      47, 157, 46, 150, 35, 176, 121, 92, 59, 78, 20, 21, 182, 52, 54, 161, 161,
      191, 51, 136, 126, 79, 166, 103, 137, 125, 199, 9, 10, 177, 58, 92, 76,
      52, 143, 56, 17, 186, 171, 160, 139, 109, 170,
    ],
    output: 356,
  },
  {
    input: [103, 18, 129, 138, 122, 43, 14, 91, 91, 152, 146, 65, 167],
    output: 273,
  },
  {
    input: [
      102, 45, 63, 184, 150, 122, 42, 138, 124, 53, 64, 38, 199, 169, 189, 195,
      128, 115, 33, 151, 85, 125, 18, 13, 186, 139, 177, 170, 143, 29, 14, 186,
      81, 108,
    ],
    output: 345,
  },
  {
    input: [
      29, 122, 103, 91, 95, 5, 13, 85, 57, 27, 73, 173, 176, 16, 134, 3, 60, 51,
      44,
    ],
    output: 289,
  },
  {
    input: [
      126, 93, 146, 129, 19, 96, 128, 86, 92, 17, 40, 41, 7, 35, 86, 76, 48, 57,
      191, 8, 109, 8, 143, 157, 87, 42, 177, 48, 122, 111, 166, 185, 129, 134,
      104, 20, 190, 79, 193, 91, 34, 2, 157, 121, 103,
    ],
    output: 369,
  },
  {
    input: [17, 22, 29, 116, 19, 106, 176, 164, 113, 120, 181, 14],
    output: 261,
  },
  {
    input: [
      15, 39, 164, 98, 142, 187, 166, 133, 166, 200, 145, 41, 174, 1, 52, 104,
      51, 39, 197, 195, 194, 29, 13, 1, 92, 120, 103, 79, 176, 27, 33, 146, 138,
      93, 14, 184, 114, 183, 94, 34, 97, 20, 193,
    ],
    output: 388,
  },
  {
    input: [
      28, 119, 62, 200, 112, 116, 64, 137, 9, 154, 29, 132, 48, 173, 65, 143,
      25, 67,
    ],
    output: 336,
  },
  {
    input: [
      20, 138, 120, 109, 22, 115, 94, 173, 150, 197, 137, 2, 56, 199, 5, 96,
      129, 190, 100, 80, 26, 195, 182, 86, 136, 197, 88, 17, 29, 129, 30, 134,
      48, 67,
    ],
    output: 389,
  },
  { input: [128, 186, 112, 52, 134, 133, 165], output: 171 },
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

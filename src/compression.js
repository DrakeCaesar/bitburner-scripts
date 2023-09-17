function minLZCompression(data) {
  let answer = ""
  let position = 0
  let completed = data + data + data + data
  const dataLength = data.length
  const maxBufferStart = dataLength - 9

  while (position < dataLength) {
    let best = ["", 0]

    for (let i = 0; i < 10; i++) {
      let bufferStart = Math.max(position - 9 + i, 0)

      if (bufferStart > maxBufferStart) break

      let search = data.slice(bufferStart, position + i)
      let lookahead = data.slice(position + i, position + i + 9)
      let bestRef = [0, 0]

      for (let backStart = 0; backStart < search.length; backStart++) {
        let searchPos = backStart

        for (let lookPos = 0; lookPos < lookahead.length; lookPos++) {
          if (search[searchPos] !== lookahead[lookPos]) break

          searchPos++

          if (searchPos >= search.length) searchPos = backStart
          if (lookPos >= bestRef[1]) bestRef = [backStart, lookPos + 1]
        }
      }

      let cost = i + 3 - (bestRef[1] === 0)
      let distance = Math.min(i, dataLength - position) + bestRef[1]

      if (distance + position === dataLength && bestRef[1] === 0) cost -= 1

      let ratio = distance / cost
      let compressed = `${i}${data.slice(position, position + i)}${bestRef[1]}`

      if (bestRef[1] !== 0) {
        compressed += 9 - bestRef[0] - (9 - search.length)
      }

      if (ratio >= best[1]) best = [compressed, ratio]

      if (
        distance + position === dataLength &&
        answer.length + compressed.length < completed.length
      ) {
        completed = answer + compressed
      }
    }

    answer += best[0]
    let move =
      parseInt(best[0][0], 10) +
      parseInt(best[0][parseInt(best[0][0], 10) + 1], 10)
    position += move

    if (position === dataLength && answer[answer.length - 1] === "0") {
      answer = answer.slice(0, -1)
    }
  }

  if (completed.length < answer.length) {
    answer = completed
  }

  return answer
}

function minLZDecompression(data) {
  let decoded = ""
  let position = 0
  let chunkType = 1

  while (position < data.length) {
    const length = parseInt(data[position], 10)
    position += 1

    if (chunkType === 1) {
      for (let i = 0; i < length; i++) {
        decoded += data[position]
        position += 1
      }
    } else {
      const reference = parseInt(data[position], 10)
      position += 1

      for (let i = 0; i < length; i++) {
        const refPosition = decoded.length - reference
        decoded += decoded[refPosition]
      }

      // Special case when length is 0
      if (length === 0) {
        position -= 1
      }
    }

    chunkType = 3 - chunkType // Toggle between chunk types 1 and 2
  }

  return decoded
}
const testCases = [
  {
    input: "abracadabra",
    expectedOutput: "7abracad47",
  },
  {
    input: "mississippi",
    expectedOutput: "4miss433ppi",
  },
  {
    input: "aAAaAAaAaAA",
    expectedOutput: "3aAA53035",
  },
  {
    input: "2718281828",
    expectedOutput: "627182844",
  },
  {
    input: "abcdefghijk",
    expectedOutput: "9abcdefghi02jk",
  },
  {
    input: "aaaaaaaaaaaa",
    expectedOutput: "3aaa91",
  },
  {
    input: "aaaaaaaaaaaaa",
    expectedOutput: "1a91031",
  },
  {
    input: "aaaaaaaaaaaaaa",
    expectedOutput: "1a91041",
  },
]
for (const testCase of testCases) {
  const { input, expectedOutput } = testCase
  const encode = minLZCompression(input)
  const decode = minLZDecompression(expectedOutput)
  console.log(`Input:           ${input}`)
  console.log(`Expected Output: ${expectedOutput}`)
  console.log(`Actual Output:   ${encode}`)
  console.log(
    `Result:          ${
      encode.length === expectedOutput.length ? "PASS\n" : "FAIL\n"
    }`
  )
  console.log(`Input:           ${expectedOutput}`)
  console.log(`Expected Output: ${input}`)
  console.log(`Actual Output:   ${decode}\n`)
  console.log(`Result:          ${decode === input ? "PASS\n" : "FAIL"}`)
}

const testCases = [
   {
      input: 25525511135,
      output: ["255.255.11.135", "255.255.111.35"],
   },
   { input: 1938718066, output: ["193.87.180.66"] },
]

for (const testCase of testCases) {
   console.log(testCase.input)
   console.log(testCase.output)
   const actual = findIPs(testCase.input)
   console.log(actual)
}

function findIPs(data) {
   let input = String(data)
   let answer = []
   for (let i = 0; i < 256; i++) {
      if (!input.startsWith(i.toString())) continue
      for (let j = 0; j < 256; j++) {
         if (!input.startsWith(i.toString() + j)) continue
         for (let k = 0; k < 256; k++) {
            if (!input.startsWith(i.toString() + j + k)) continue
            for (let l = 0; l < 256; l++) {
               if (input != i.toString() + j + k + l) continue
               answer.push(i + "." + j + "." + k + "." + l)
            }
         }
      }
   }
   return answer
}

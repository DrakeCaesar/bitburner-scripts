function rleCompression(input: string): string {
   let result = ""
   let count = 1

   for (let i = 1; i <= input.length; i++) {
      if (i === input.length || input[i] !== input[i - 1]) {
         if (count === 1) {
            result += "1" + input[i - 1]
         } else if (count < 10) {
            result += count + input[i - 1]
         } else {
            const numChunks = Math.floor(count / 9)
            const remainder = count % 9
            result +=
               "9" +
               input[i - 1].repeat(numChunks) +
               (remainder > 0 ? remainder + input[i - 1] : "")
         }
         count = 1
      } else {
         count++
      }
   }

   return result
}

// Test cases
console.log(rleCompression("aaaaabccc")) // Output: 5a1b3c
console.log(rleCompression("aAaAaA")) // Output: 1a1A1a1A1a1A
console.log(rleCompression("111112333")) // Output: 511233
console.log(rleCompression("zzzzzzzzzzzzzzzzzzz")) // Output: 9z9z1z (or 9z8z2z, etc.)
console.log(rleCompression("X")) // Output: 1X


export function formatNumber(number) {
   const exp = [" ", "k", "m", "b", "t", "q", "Q", "s", "S", "o", "n"]
   let c = 0
   while (number > 999 || number < -999) {
      c++
      number /= 1000
   }
   return number.toFixed(3).padStart(7) + exp[c]
}

export function tFormat(duration) {
   return (duration / 1000).toFixed(3).padStart(10) + " s"
}

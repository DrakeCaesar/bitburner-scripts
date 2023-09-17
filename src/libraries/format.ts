export function formatNumber(number: number): string {
  const exp = [" ", "k", "m", "b", "t", "q", "Q", "s", "S", "o", "n"]
  let c = 0
  while (number > 999 || number < -999) {
    c++
    number /= 1000
  }
  const suffix = c >= exp.length ? "█" : exp[c]
  return number.toFixed(3).padStart(7) + suffix
}

export function tFormat(duration: number) {
  return (duration / 1000).toFixed(3).padStart(10) + " s"
}

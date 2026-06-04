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

/** Sub-second values as ms; otherwise delegate to game formatter (e.g. ns.format.time). */
export function formatGameTimeMs(ms: number, formatTime: (ms: number) => string): string {
  if (!Number.isFinite(ms)) return "n/a"
  const rounded = Math.round(ms)
  if (Math.abs(rounded) < 1000) return `${rounded}ms`
  return formatTime(rounded)
}

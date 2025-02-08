// Define an interval as a tuple [lower, upper]
type Interval = [number, number]

// Returns the hack interval for index n:
// H(n) = [hackTime/(2*n+1), hackTime/(2*n)]
function getHackInterval(n: number, hackTime: number): Interval {
  const lower = hackTime / (2 * n + 1)
  const upper = hackTime / (2 * n)
  return [lower, upper]
}

// Returns the grow interval for index m.
// Given that growTime = 3.2 * hackTime, we have:
// G(m) = [3.2*hackTime/(2*m+1), 3.2*hackTime/(2*m)]
function getGrowInterval(m: number, hackTime: number): Interval {
  const growTime = 3.2 * hackTime
  const lower = growTime / (2 * m + 1)
  const upper = growTime / (2 * m)
  return [lower, upper]
}

// Computes the intersection of two intervals.
// If the intervals [a, b] and [c, d] overlap, returns [max(a, c), min(b, d)].
// Otherwise, returns null.
function intersectIntervals(
  interval1: Interval,
  interval2: Interval
): Interval | null {
  const [a, b] = interval1
  const [c, d] = interval2
  const lower = Math.max(a, c)
  const upper = Math.min(b, d)
  return lower <= upper ? [lower, upper] : null
}

// An interface for the raw intersection result for a given m.
interface CroppedInterval {
  m: number
  intersection: Interval
}

/**
 * For a given hack interval H(n) (with index n), this function finds all grow intervals
 * G(m) that overlap H(n) by scanning downward and upward from an estimated candidate m.
 * It returns an array of raw intersections.
 */
function getCroppedIntervals(n: number, hackTime: number): CroppedInterval[] {
  const H = getHackInterval(n, hackTime)

  // Start with a candidate m ~ 3.2 * n.
  let candidateM = Math.max(1, Math.round(3.2 * n))

  // Search downward: decrease m until the grow interval no longer overlaps H.
  let mDown = candidateM
  while (mDown >= 1) {
    const G = getGrowInterval(mDown, hackTime)
    if (intersectIntervals(H, G) === null) {
      break
    }
    mDown--
  }
  const mMin = mDown + 1 // last m that produced an intersection

  // Search upward: increase m until the grow interval no longer overlaps H.
  let mUp = candidateM + 1
  while (true) {
    const G = getGrowInterval(mUp, hackTime)
    if (intersectIntervals(H, G) === null) {
      break
    }
    mUp++
  }
  const mMax = mUp - 1 // last m that produced an intersection

  // Collect all intersections for m in [mMin, mMax]
  const intersections: CroppedInterval[] = []
  for (let m = mMin; m <= mMax; m++) {
    const G = getGrowInterval(m, hackTime)
    const inter = intersectIntervals(H, G)
    if (inter !== null) {
      intersections.push({ m, intersection: inter })
    }
  }
  return intersections
}

/**
 * Merges an array of intervals into a union.
 * If intervals overlap or touch, they are merged into one.
 */
function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return []

  // Sort intervals by their lower bound.
  intervals.sort((a, b) => a[0] - b[0])

  const merged: Interval[] = []
  let current = intervals[0]

  for (let i = 1; i < intervals.length; i++) {
    const next = intervals[i]
    // If the current interval overlaps or touches the next interval, merge them.
    if (current[1] >= next[0]) {
      current = [current[0], Math.max(current[1], next[1])]
    } else {
      merged.push(current)
      current = next
    }
  }
  merged.push(current)
  return merged
}

/**
 * Given a hack interval H(n) for a specified index n, this function returns the final
 * union of intersections between H(n) and all overlapping grow intervals.
 * The result is an array of one or more intervals.
 */
function getFinalIntersections(n: number, hackTime: number): Interval[] {
  const rawCropped = getCroppedIntervals(n, hackTime)
  const intersections = rawCropped.map((ci) => ci.intersection)
  const merged = mergeIntervals(intersections)
  return merged
}

// --- Example Usage ---

const hackTime: number = 1270.5873382302843 // example hackTime value

// Example 1: For hack interval n=3.
const n1 = 3
const H1 = getHackInterval(n1, hackTime)
console.log(
  `Hack interval for n=${n1}: [${H1[0].toFixed(1)} ms, ${H1[1].toFixed(1)} ms]`
)

const cropped1 = getCroppedIntervals(n1, hackTime)
console.log(
  `\nFor hack interval n=${n1}, the raw grow intervals that overlap (and their intersections) are:`
)
cropped1.forEach((ci) => {
  const G = getGrowInterval(ci.m, hackTime)
  console.log(`For m=${ci.m}:`)
  console.log(`  Grow interval: [${G[0].toFixed(1)} ms, ${G[1].toFixed(1)} ms]`)
  console.log(
    `  Intersection:  [${ci.intersection[0].toFixed(1)} ms, ${ci.intersection[1].toFixed(1)} ms]`
  )
})

const final1 = getFinalIntersections(n1, hackTime)
console.log(`\nFinal union of intersections for hack interval n=${n1}:`)
final1.forEach((intv, i) => {
  console.log(
    `  Interval ${i + 1}: [${intv[0].toFixed(1)} ms, ${intv[1].toFixed(1)} ms]`
  )
})

// Example 2: For hack interval n=2.
const n2 = 2
const H2 = getHackInterval(n2, hackTime)
console.log(
  `\nHack interval for n=${n2}: [${H2[0].toFixed(1)} ms, ${H2[1].toFixed(1)} ms]`
)

const cropped2 = getCroppedIntervals(n2, hackTime)
console.log(
  `\nFor hack interval n=${n2}, the raw grow intervals that overlap (and their intersections) are:`
)
cropped2.forEach((ci) => {
  const G = getGrowInterval(ci.m, hackTime)
  console.log(`For m=${ci.m}:`)
  console.log(`  Grow interval: [${G[0].toFixed(1)} ms, ${G[1].toFixed(1)} ms]`)
  console.log(
    `  Intersection:  [${ci.intersection[0].toFixed(1)} ms, ${ci.intersection[1].toFixed(1)} ms]`
  )
})

const final2 = getFinalIntersections(n2, hackTime)
console.log(`\nFinal union of intersections for hack interval n=${n2}:`)
final2.forEach((intv, i) => {
  console.log(
    `  Interval ${i + 1}: [${intv[0].toFixed(1)} ms, ${intv[1].toFixed(1)} ms]`
  )
})

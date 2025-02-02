/** @param {import("..").NS} ns */
export async function main(ns) {
  // === INITIAL SETUP & FORMULA QUERIES ===
  // Usage: run script.js target [deltaSeconds]
  const target = ns.args[0]
  if (!target) {
    ns.tprint("Usage: run script.js [target] [deltaSeconds]")
    return
  }
  // Optionally, a delta interval (in seconds) may be provided.
  let userDeltaSec = ns.args[1]

  const serverObj = ns.getServer(target)
  const player = ns.getPlayer()

  // Query durations (in ms) using game formulas.
  const hackTime = ns.formulas.hacking.hackTime(serverObj, player)
  const growTime = ns.formulas.hacking.growTime(serverObj, player)
  const weakenTime = ns.formulas.hacking.weakenTime(serverObj, player)

  // If user provided a delta (in seconds), convert to ms.
  // Otherwise, choose a safe delta = 1.1 * max(op duration)
  const delta = userDeltaSec
    ? parseFloat(userDeltaSec) * 1000
    : Math.max(hackTime, growTime, weakenTime) * 0.1

  ns.tprint(`Using delta = ${delta.toFixed(0)} ms`)

  // === BATCH SCHEDULING ===
  // We define each batch (numbered 0 .. numBatches-1) with four operations.
  // Their finish times relative to the batch base are:
  //   Weaken1 finishes at base + 0
  //   Hack    finishes at base + Δ
  //   Grow    finishes at base + 2Δ
  //   Weaken2 finishes at base + 3Δ
  //
  // Their start times are: (finish time – opDuration)
  //
  // The batch base for batch i is: i * (4 * delta)
  //
  // We'll compute absolute start & finish times for each op in each batch.
  const numBatches = 10
  let batches = [] // each element: { batchIndex, ops: [ { label, start, finish, duration } ] }

  // Define our op labels and associated durations.
  const opDefs = [
    { label: "Weaken1", duration: weakenTime, finishOffset: 0 },
    { label: "Hack", duration: hackTime, finishOffset: delta },
    { label: "Grow", duration: growTime, finishOffset: 2 * delta },
    { label: "Weaken2", duration: weakenTime, finishOffset: 3 * delta },
  ]

  for (let i = 0; i < numBatches; i++) {
    const batchBase = i * (4 * delta)
    let ops = []
    for (let opDef of opDefs) {
      const finishTime = batchBase + opDef.finishOffset
      const startTime = finishTime - opDef.duration
      ops.push({
        label: opDef.label,
        start: startTime,
        finish: finishTime,
        duration: opDef.duration,
      })
    }
    batches.push({ batchIndex: i, ops })
  }

  // === GROUPING BATCHES TO AVOID VISUAL OVERLAP ===
  // We want to assign batches to vertical groups so that within a given group,
  // for each op row, a batch's op does not overlap (horizontally) with the previous batch's op.
  // We define a group as an array of batches and we track for each op row the last finish time.
  let groups = [] // each group: { batches: [batch, ...], lastFinish: [w1, hack, grow, w2] }

  batches.forEach((batch) => {
    // For each op in the batch, get its start times.
    const opStarts = batch.ops.map((op) => op.start)
    const opFinishes = batch.ops.map((op) => op.finish)

    // Try to place this batch in an existing group.
    let placed = false
    for (let group of groups) {
      // Check if for every op row, the current batch's op starts AFTER the last op in that group finished.
      let canPlace = true
      for (let j = 0; j < opStarts.length; j++) {
        if (opStarts[j] < group.lastFinish[j]) {
          canPlace = false
          break
        }
      }
      if (canPlace) {
        group.batches.push(batch)
        // Update the lastFinish times for each op row.
        for (let j = 0; j < opFinishes.length; j++) {
          group.lastFinish[j] = opFinishes[j]
        }
        placed = true
        break
      }
    }
    // If no existing group can hold this batch, create a new group.
    if (!placed) {
      groups.push({
        batches: [batch],
        lastFinish: opFinishes.slice(), // copy the array
      })
    }
  })

  ns.tprint(
    `Grouped ${numBatches} batches into ${groups.length} vertical group(s).`
  )

  // === DETERMINE GLOBAL TIME BOUNDS FOR DRAWING ===
  // Find the minimum start time (may be negative) and maximum finish time.
  let globalMin = Infinity
  let globalMax = -Infinity
  groups.forEach((group) => {
    group.batches.forEach((batch) => {
      batch.ops.forEach((op) => {
        if (op.start < globalMin) globalMin = op.start
        if (op.finish > globalMax) globalMax = op.finish
      })
    })
  })
  // We'll shift all times by -globalMin so that the leftmost time is 0.
  const timeOffset = -globalMin

  // === DRAWING THE TIMELINE ===
  // We will create one container for all groups. Each group gets its own set of 4 rows.
  const scale = 0.05 // pixels per ms; adjust as desired.

  // Compute overall width based on globalMax + offset.
  const timelineWidthPx = (globalMax + timeOffset) * scale + 120

  // Create the overall container.
  const container = document.createElement("div")
  container.style.position = "relative"
  container.style.width = timelineWidthPx + "px"
  container.style.margin = "20px auto"
  container.style.border = "1px solid #000"
  container.style.padding = "20px"
  container.style.backgroundColor = "#f9f9f9"
  container.style.fontFamily = "monospace"

  // Add a heading.
  const heading = document.createElement("h3")
  heading.textContent = `Batch Timeline for ${target} (Grouped in ${groups.length} set(s))`
  heading.style.textAlign = "center"
  container.appendChild(heading)

  // For each group, create 4 rows (one per op).
  // Define row labels and colors matching opDefs order.
  const rowLabels = ["Weaken1", "Hack", "Grow", "Weaken2"]
  const rowColors = ["#FFAAAA", "#FFFFAA", "#AAFFAA", "#AAAFFF"]
  const rowHeight = 50
  const groupGap = 20 // vertical gap between groups

  // Track the vertical offset (in px) for drawing groups.
  let verticalOffset = 0

  groups.forEach((group, groupIndex) => {
    // Create a container for this group.
    const groupContainer = document.createElement("div")
    groupContainer.style.position = "relative"
    // Height: 4 rows + groupGap.
    groupContainer.style.height = 4 * rowHeight + groupGap + "px"
    groupContainer.style.marginBottom = groupGap + "px"

    // For each op (row), create a row container.
    for (let opIndex = 0; opIndex < 4; opIndex++) {
      const row = document.createElement("div")
      row.style.position = "absolute"
      row.style.top = opIndex * rowHeight + "px"
      row.style.left = "0px"
      row.style.height = rowHeight + "px"
      row.style.borderBottom = "1px solid #ccc"

      // Create the left-hand label.
      const labelDiv = document.createElement("div")
      labelDiv.textContent = rowLabels[opIndex]
      labelDiv.style.position = "absolute"
      labelDiv.style.left = "0"
      labelDiv.style.top = "0"
      labelDiv.style.width = "100px"
      labelDiv.style.height = rowHeight + "px"
      labelDiv.style.lineHeight = rowHeight + "px"
      labelDiv.style.backgroundColor = "#eee"
      labelDiv.style.borderRight = "1px solid #ccc"
      labelDiv.style.textAlign = "right"
      labelDiv.style.paddingRight = "5px"
      row.appendChild(labelDiv)

      // Create the timeline area for this row.
      const rowTimeline = document.createElement("div")
      rowTimeline.style.position = "absolute"
      rowTimeline.style.left = "100px" // reserve space for label
      rowTimeline.style.top = "0"
      rowTimeline.style.height = rowHeight + "px"
      // Width spans the entire timeline.
      rowTimeline.style.width = timelineWidthPx - 120 + "px"
      rowTimeline.style.borderLeft = "1px solid #ccc"
      row.appendChild(rowTimeline)

      // For each batch in this group, if it has an op for this row, draw its block.
      group.batches.forEach((batch) => {
        const op = batch.ops[opIndex]
        // Compute shifted start time in ms.
        const shiftedStart = op.start + timeOffset
        const blockLeft = shiftedStart * scale
        const blockWidth = op.duration * scale

        const block = document.createElement("div")
        block.style.position = "absolute"
        block.style.left = blockLeft + "px"
        block.style.width = blockWidth + "px"
        block.style.height = rowHeight - 10 + "px"
        block.style.top = "5px"
        block.style.backgroundColor = rowColors[opIndex]
        block.style.border = "1px solid #000"
        block.style.boxSizing = "border-box"
        block.title = `${op.label} (Batch ${batch.batchIndex + 1}):\nstart=${op.start.toFixed(0)} ms, duration=${op.duration.toFixed(0)} ms, finish=${op.finish.toFixed(0)} ms`

        rowTimeline.appendChild(block)
      })

      groupContainer.appendChild(row)
    }
    // Position this group container vertically.
    groupContainer.style.top = verticalOffset + "px"
    verticalOffset += parseInt(groupContainer.style.height) + groupGap
    container.appendChild(groupContainer)
  })

  // ---- Add a common X-axis ruler (optional) ----
  const ruler = document.createElement("div")
  ruler.style.position = "relative"
  ruler.style.height = "20px"
  ruler.style.width = timelineWidthPx + "px"
  ruler.style.marginTop = "10px"
  ruler.style.borderTop = "1px solid #000"

  // Tick marks every (say) 1 second (1000 ms) along the timeline.
  const tickInterval = 1000 // ms
  for (let t = 0; t <= globalMax + timeOffset; t += tickInterval) {
    const tick = document.createElement("div")
    tick.style.position = "absolute"
    tick.style.left = 100 + t * scale + "px"
    tick.style.top = "0px"
    tick.style.width = "1px"
    tick.style.height = "10px"
    tick.style.backgroundColor = "#000"
    ruler.appendChild(tick)

    const tickLabel = document.createElement("div")
    tickLabel.style.position = "absolute"
    tickLabel.style.left = 100 + t * scale - 10 + "px"
    tickLabel.style.top = "10px"
    tickLabel.style.fontSize = "10px"
    tickLabel.textContent = `${t} ms`
    ruler.appendChild(tickLabel)
  }
  container.appendChild(ruler)

  // ---- Insert the timeline into the document body ----
  document.body.appendChild(container)

  // (Optional pause so you can inspect the diagram)
  // await ns.sleep(10000);
}

export type WireColorName = "RED" | "YELLOW" | "BLUE" | "WHITE"

export interface WireCutQuestion {
  type: "position" | "color"
  wireNumber?: number
  color?: WireColorName
}

export interface WireCuttingDomState {
  questions: WireCutQuestion[]
  wireCount: number
  /** Unique colors per wire (0-based index). */
  wireColors: WireColorName[][]
  /** Wires already cut in the UI. */
  cutWires: boolean[]
  /** 1-based wire numbers still to cut. */
  remainingWireNumbers: number[]
}

export function isWireCuttingTask(taskTitle: string): boolean {
  const title = taskTitle.trim().toLowerCase()
  return title.includes("cut the wire") || title.includes("keyboard 1 to 9")
}

export function isWireCutRuleText(text: string): boolean {
  return parseQuestion(text) !== null
}

function looksLikeWireGrid(cells: Element[]): boolean {
  let wireCount = 0
  while (wireCount < cells.length && isHeaderNumberCell(cellText(cells[wireCount]))) {
    wireCount++
  }
  if (wireCount < 4) return false
  if (wireCount >= cells.length) return false
  return isWireLetterCell(cellText(cells[wireCount]))
}

export function isWireCuttingTaskRoot(taskRoot: Element): boolean {
  const title = taskRoot.querySelector("h4")?.textContent?.trim() ?? ""
  if (title === "Match the symbols!") return false
  if (isWireCuttingTask(title)) return true

  for (const paragraph of Array.from(taskRoot.querySelectorAll("p"))) {
    if (isWireCutRuleText(paragraph.textContent?.trim() ?? "")) {
      return true
    }
  }

  return findWireGridCells(taskRoot).length > 0
}

function parseQuestion(text: string): WireCutQuestion | null {
  const positionMatch = text.match(/cut wire number\s+(\d+)/i)
  if (positionMatch) {
    return { type: "position", wireNumber: Number(positionMatch[1]) }
  }

  const colorMatch = text.match(/cut all wires colored\s+(red|yellow|blue|white)/i)
  if (colorMatch) {
    return { type: "color", color: colorMatch[1].toUpperCase() as WireColorName }
  }

  return null
}

function parseWireColor(styleColor: string): WireColorName | null {
  const color = styleColor.trim().toLowerCase()
  if (color === "red") return "RED"
  if (color === "blue") return "BLUE"
  if (color === "white") return "WHITE"
  if (color.includes("255, 193, 7") || color === "#ffc107") return "YELLOW"
  return null
}

function cellText(element: Element): string {
  return element.textContent?.trim() ?? ""
}

function isHeaderNumberCell(text: string): boolean {
  return /^\d+$/.test(text)
}

function isWireLetterCell(text: string): boolean {
  return /^\|[A-Z]\|$/.test(text)
}

function wireLetterAt(text: string): string {
  const match = text.match(/^\|([A-Z])\|$/)
  return match?.[1] ?? ""
}

function findWireGridCells(taskRoot: Element): Element[] {
  const box = taskRoot.querySelector("div[class*='MuiBox-root']")
  if (box) {
    const boxCells = Array.from(box.querySelectorAll("p"))
    if (looksLikeWireGrid(boxCells)) return boxCells
  }

  const paragraphs = Array.from(taskRoot.querySelectorAll("p"))
  for (let i = 0; i < paragraphs.length; i++) {
    if (cellText(paragraphs[i]) !== "1") continue

    let wireCount = 0
    while (i + wireCount < paragraphs.length && cellText(paragraphs[i + wireCount]) === String(wireCount + 1)) {
      wireCount++
    }

    if (wireCount < 4) continue

    const gridCells = paragraphs.slice(i)
    if (!looksLikeWireGrid(gridCells)) continue

    const dataCellCount = gridCells.length - wireCount
    if (dataCellCount >= wireCount * 11) {
      return gridCells
    }
  }

  return []
}

interface WireGridLayout {
  wireCount: number
  rowStarts: number[]
  row3Len: number
  dataCells: Element[]
}

function buildWireGridLayout(cells: Element[]): WireGridLayout | null {
  let wireCount = 0
  while (wireCount < cells.length && isHeaderNumberCell(cellText(cells[wireCount]))) {
    wireCount++
  }
  if (wireCount === 0) return null

  const dataCells = cells.slice(wireCount)
  const rowCount = 11
  const headRows = 3 * wireCount
  const tailRows = 6 * wireCount
  const middleCells = dataCells.length - headRows - tailRows

  if (middleCells < 0) {
    if (dataCells.length !== wireCount * rowCount) return null
  } else if (middleCells % 2 !== 0) {
    return null
  }

  const row3Len = middleCells >= 0 ? middleCells / 2 : wireCount

  const rowStarts: number[] = []
  let offset = 0
  for (let row = 0; row < rowCount; row++) {
    rowStarts.push(offset)
    if (row === 3) offset += row3Len
    else if (row === 4) offset += row3Len
    else offset += wireCount
  }

  return { wireCount, rowStarts, row3Len, dataCells }
}

function wireLetter(layout: WireGridLayout, wire: number, row: number): string {
  const index = layout.rowStarts[row] + wire
  if (index >= layout.dataCells.length) return ""
  return wireLetterAt(cellText(layout.dataCells[index]))
}

function deriveWireType(layout: WireGridLayout, wire: number): string {
  const sampleRows = [0, 1, 2, 5, 6, 7, 8, 9, 10]
  const samples: { row: number; letter: string }[] = []

  for (const row of sampleRows) {
    const letter = wireLetter(layout, wire, row)
    if (letter) samples.push({ row, letter })
  }

  if (samples.length === 0) return ""

  for (let len = 1; len <= 8; len++) {
    let candidate = ""
    for (let i = 0; i < len; i++) {
      const sample = samples.find((entry) => entry.row === i)
      candidate += sample?.letter ?? samples[0].letter
    }

    let matches = true
    for (const sample of samples) {
      if (candidate[sample.row % len] !== sample.letter) {
        matches = false
        break
      }
    }

    if (matches) return candidate
  }

  return samples[0].letter
}

function expectedRowLetter(layout: WireGridLayout, wire: number, row: number): string {
  const wireType = deriveWireType(layout, wire)
  if (!wireType) return ""
  return wireType[row % wireType.length]
}

function inferCutWires(layout: WireGridLayout): boolean[] {
  if (layout.row3Len >= layout.wireCount) {
    return new Array(layout.wireCount).fill(false)
  }

  const row3Letters: string[] = []
  for (let i = 0; i < layout.row3Len; i++) {
    row3Letters.push(wireLetterAt(cellText(layout.dataCells[layout.rowStarts[3] + i])))
  }

  const target = row3Letters.join("")

  for (let mask = 0; mask < 1 << layout.wireCount; mask++) {
    const cut = new Array(layout.wireCount).fill(false)
    for (let j = 0; j < layout.wireCount; j++) {
      cut[j] = (mask & (1 << j)) !== 0
    }

    let sequence = ""
    for (let j = 0; j < layout.wireCount; j++) {
      if (cut[j]) continue
      sequence += expectedRowLetter(layout, j, 3)
    }

    if (sequence === target) {
      return cut
    }
  }

  return new Array(layout.wireCount).fill(false)
}

function parseWireGrid(taskRoot: Element): Pick<WireCuttingDomState, "wireCount" | "wireColors" | "cutWires"> | null {
  const gridCells = findWireGridCells(taskRoot)
  const layout = buildWireGridLayout(gridCells)
  if (!layout) return null

  const cutWires = inferCutWires(layout)
  const wireColors: WireColorName[][] = []

  for (let wire = 0; wire < layout.wireCount; wire++) {
    const colors = new Set<WireColorName>()
    for (let row = 0; row < 11; row++) {
      if (row === 3 || row === 4) continue
      const index = layout.rowStarts[row] + wire
      if (index >= layout.dataCells.length) continue
      const color = parseWireColor((layout.dataCells[index] as HTMLElement).style.color)
      if (color) colors.add(color)
    }
    wireColors.push([...colors])
  }

  return { wireCount: layout.wireCount, wireColors, cutWires }
}

function shouldCutWire(wireIndex: number, wireColors: WireColorName[], questions: WireCutQuestion[]): boolean {
  for (const question of questions) {
    if (question.type === "position" && question.wireNumber === wireIndex + 1) {
      return true
    }
    if (question.type === "color" && question.color && wireColors.includes(question.color)) {
      return true
    }
  }
  return false
}

export function computeWiresToCut(state: Omit<WireCuttingDomState, "remainingWireNumbers">): number[] {
  const targets: number[] = []

  for (let wire = 0; wire < state.wireCount; wire++) {
    if (state.cutWires[wire]) continue
    if (shouldCutWire(wire, state.wireColors[wire] ?? [], state.questions)) {
      targets.push(wire + 1)
    }
  }

  return targets.sort((a, b) => a - b)
}

export function parseWireCuttingState(taskRoot: Element): WireCuttingDomState | null {
  const taskTitle = taskRoot.querySelector("h4")?.textContent?.trim() ?? ""
  if (!isWireCuttingTask(taskTitle) && !isWireCuttingTaskRoot(taskRoot)) return null

  const questions: WireCutQuestion[] = []
  for (const paragraph of Array.from(taskRoot.querySelectorAll("p"))) {
    const question = parseQuestion(paragraph.textContent?.trim() ?? "")
    if (question) questions.push(question)
  }

  const grid = parseWireGrid(taskRoot)
  if (!grid || questions.length === 0) return null

  const partial = { questions, ...grid }
  return {
    ...partial,
    remainingWireNumbers: computeWiresToCut(partial),
  }
}

export function solveWireCuttingKeys(state: WireCuttingDomState | null | undefined): string[] | null {
  if (!state?.remainingWireNumbers.length) return null
  return state.remainingWireNumbers.map(String)
}

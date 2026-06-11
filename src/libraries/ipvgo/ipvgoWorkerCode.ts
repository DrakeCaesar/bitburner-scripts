/**
 * Self-contained IPvGO MCTS worker source.
 * Loaded via ns.read() into a Worker blob (same pattern as contractWorker.js).
 */

type Board = string[]
type Color = "X" | "O"
type Move = { type: "move"; x: number; y: number } | { type: "pass" }

type MctsNode = {
  move: Move | null
  player: Color
  board: Board
  history: Board[]
  komi: number
  passes: number
  parent: MctsNode | null
  children: MctsNode[]
  untried: Move[]
  visits: number
  wins: number
}

function ipvgoBoardSize(board: Board): number {
  return board[0]?.length ?? 0
}

function ipvgoCloneBoard(board: Board): Board {
  return board.map((col) => col)
}

function ipvgoBoardKey(board: Board): string {
  return board.join("|")
}

function ipvgoOpponent(color: Color): Color {
  return color === "X" ? "O" : "X"
}

function ipvgoInBounds(size: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size
}

function ipvgoNeighbors(board: Board, x: number, y: number): Array<[number, number]> {
  const size = ipvgoBoardSize(board)
  const out: Array<[number, number]> = []
  if (ipvgoInBounds(size, x, y - 1)) out.push([x, y - 1])
  if (ipvgoInBounds(size, x + 1, y)) out.push([x + 1, y])
  if (ipvgoInBounds(size, x, y + 1)) out.push([x, y + 1])
  if (ipvgoInBounds(size, x - 1, y)) out.push([x, y - 1])
  return out
}

function ipvgoCollectChain(board: Board, x: number, y: number, color: Color): Array<[number, number]> {
  const visited = new Set<string>()
  const stack: Array<[number, number]> = [[x, y]]
  const chain: Array<[number, number]> = []

  while (stack.length > 0) {
    const [cx, cy] = stack.pop()!
    const key = `${cx},${cy}`
    if (visited.has(key)) continue
    visited.add(key)
    if (board[cx][cy] !== color) continue
    chain.push([cx, cy])
    for (const [nx, ny] of ipvgoNeighbors(board, cx, cy)) {
      if (!visited.has(`${nx},${ny}`) && board[nx][ny] === color) {
        stack.push([nx, ny])
      }
    }
  }

  return chain
}

function ipvgoChainLiberties(board: Board, chain: Array<[number, number]>): Set<string> {
  const liberties = new Set<string>()
  for (const [x, y] of chain) {
    for (const [nx, ny] of ipvgoNeighbors(board, x, y)) {
      if (board[nx][ny] === ".") liberties.add(`${nx},${ny}`)
    }
  }
  return liberties
}

function ipvgoRemoveChain(board: Board, chain: Array<[number, number]>): void {
  for (const [x, y] of chain) {
    board[x] = board[x].slice(0, y) + "." + board[x].slice(y + 1)
  }
}

function ipvgoWouldCapture(board: Board, x: number, y: number, color: Color): boolean {
  const opponent = ipvgoOpponent(color)
  for (const [nx, ny] of ipvgoNeighbors(board, x, y)) {
    if (board[nx][ny] !== opponent) continue
    const chain = ipvgoCollectChain(board, nx, ny, opponent)
    const liberties = ipvgoChainLiberties(board, chain)
    liberties.delete(`${x},${y}`)
    if (liberties.size === 0) return true
  }
  return false
}

function ipvgoApplyMove(board: Board, x: number, y: number, color: Color): Board | null {
  const size = ipvgoBoardSize(board)
  if (!ipvgoInBounds(size, x, y)) return null
  if (board[x][y] !== ".") return null

  const next = ipvgoCloneBoard(board)
  next[x] = next[x].slice(0, y) + color + next[x].slice(y + 1)

  const opponent = ipvgoOpponent(color)
  for (const [nx, ny] of ipvgoNeighbors(next, x, y)) {
    if (next[nx][ny] !== opponent) continue
    const chain = ipvgoCollectChain(next, nx, ny, opponent)
    const liberties = ipvgoChainLiberties(next, chain)
    if (liberties.size === 0) {
      ipvgoRemoveChain(next, chain)
    }
  }

  const ownChain = ipvgoCollectChain(next, x, y, color)
  if (ipvgoChainLiberties(next, ownChain).size === 0) {
    return null
  }

  return next
}

function ipvgoIsSuperko(board: Board, history: Board[]): boolean {
  const key = ipvgoBoardKey(board)
  for (const prior of history) {
    if (ipvgoBoardKey(prior) === key) return true
  }
  return false
}

function ipvgoGetLegalMoves(board: Board, history: Board[], color: Color): Move[] {
  const size = ipvgoBoardSize(board)
  const moves: Move[] = []

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (board[x][y] !== ".") continue
      const played = ipvgoApplyMove(board, x, y, color)
      if (!played) continue
      if (ipvgoIsSuperko(played, history)) continue
      moves.push({ type: "move", x, y })
    }
  }

  moves.push({ type: "pass" })
  return moves
}

function ipvgoTerritoryOwner(board: Board, emptyChain: Array<[number, number]>): Color | null {
  const colors = new Set<Color>()
  for (const [x, y] of emptyChain) {
    for (const [nx, ny] of ipvgoNeighbors(board, x, y)) {
      const stone = board[nx][ny]
      if (stone === "X" || stone === "O") colors.add(stone)
    }
  }
  if (colors.size === 1) return colors.values().next().value ?? null
  return null
}

function ipvgoEmptyChains(board: Board): Array<Array<[number, number]>> {
  const size = ipvgoBoardSize(board)
  const visited = new Set<string>()
  const chains: Array<Array<[number, number]>> = []

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (board[x][y] !== ".") continue
      const key = `${x},${y}`
      if (visited.has(key)) continue
      const chain: Array<[number, number]> = []
      const stack: Array<[number, number]> = [[x, y]]
      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!
        const ckey = `${cx},${cy}`
        if (visited.has(ckey)) continue
        if (board[cx][cy] !== ".") continue
        visited.add(ckey)
        chain.push([cx, cy])
        for (const [nx, ny] of ipvgoNeighbors(board, cx, cy)) {
          if (!visited.has(`${nx},${ny}`) && board[nx][ny] === ".") {
            stack.push([nx, ny])
          }
        }
      }
      chains.push(chain)
    }
  }

  return chains
}

function ipvgoScore(board: Board, komi: number): { black: number; white: number } {
  let blackStones = 0
  let whiteStones = 0
  let blackTerritory = 0
  let whiteTerritory = 0

  const size = ipvgoBoardSize(board)
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const stone = board[x][y]
      if (stone === "X") blackStones++
      else if (stone === "O") whiteStones++
    }
  }

  for (const chain of ipvgoEmptyChains(board)) {
    const owner = ipvgoTerritoryOwner(board, chain)
    if (owner === "X") blackTerritory += chain.length
    else if (owner === "O") whiteTerritory += chain.length
  }

  return {
    black: blackStones + blackTerritory,
    white: whiteStones + whiteTerritory + komi,
  }
}

function ipvgoMoveHeuristic(board: Board, move: Move, color: Color): number {
  if (move.type === "pass") return -5
  const { x, y } = move
  let score = 0
  if (ipvgoWouldCapture(board, x, y, color)) score += 100
  for (const [nx, ny] of ipvgoNeighbors(board, x, y)) {
    const stone = board[nx][ny]
    if (stone === color) score += 4
    else if (stone === ipvgoOpponent(color)) score += 2
  }
  if (x === 0 || y === 0 || x === ipvgoBoardSize(board) - 1 || y === ipvgoBoardSize(board) - 1) {
    score += 1
  }
  return score
}

function ipvgoApplyTurn(
  board: Board,
  history: Board[],
  move: Move,
  color: Color
): { board: Board; history: Board[]; next: Color; passes: number } | null {
  const passes = move.type === "pass" ? 1 : 0
  if (move.type === "pass") {
    return { board, history, next: ipvgoOpponent(color), passes }
  }

  const played = ipvgoApplyMove(board, move.x, move.y, color)
  if (!played) return null
  const nextHistory = [...history, ipvgoCloneBoard(board)]
  if (ipvgoIsSuperko(played, nextHistory)) return null

  return {
    board: played,
    history: nextHistory,
    next: ipvgoOpponent(color),
    passes: 0,
  }
}

function ipvgoCreateNode(
  move: Move | null,
  player: Color,
  board: Board,
  history: Board[],
  komi: number,
  passes: number,
  parent: MctsNode | null
): MctsNode {
  return {
    move,
    player,
    board,
    history,
    komi,
    passes,
    parent,
    children: [],
    untried: ipvgoGetLegalMoves(board, history, player).sort(
      (a, b) => ipvgoMoveHeuristic(board, b, player) - ipvgoMoveHeuristic(board, a, player)
    ),
    visits: 0,
    wins: 0,
  }
}

function ipvgoUctValue(node: MctsNode, child: MctsNode, exploration: number): number {
  if (child.visits === 0) return Number.POSITIVE_INFINITY
  const exploitation = child.wins / child.visits
  const explore = exploration * Math.sqrt(Math.log(node.visits) / child.visits)
  return exploitation + explore
}

function ipvgoSelectChild(node: MctsNode, exploration: number): MctsNode {
  let best = node.children[0]
  let bestValue = -Infinity
  for (const child of node.children) {
    const value = ipvgoUctValue(node, child, exploration)
    if (value > bestValue) {
      bestValue = value
      best = child
    }
  }
  return best
}

function ipvgoExpand(node: MctsNode): MctsNode {
  const move = node.untried.shift()
  if (!move) return node

  const result = ipvgoApplyTurn(node.board, node.history, move, node.player)
  if (!result) {
    return ipvgoExpand(node)
  }

  const child = ipvgoCreateNode(
    move,
    result.next,
    result.board,
    result.history,
    node.komi,
    node.passes + result.passes,
    node
  )
  node.children.push(child)
  return child
}

function ipvgoRandomChoice<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function ipvgoSimulationPolicy(board: Board, moves: Move[], color: Color): Move {
  const captures = moves.filter((m) => m.type === "move" && ipvgoWouldCapture(board, m.x, m.y, color))
  if (captures.length > 0 && Math.random() < 0.85) {
    return ipvgoRandomChoice(captures)
  }

  const nonPass = moves.filter((m) => m.type === "move")
  if (nonPass.length === 0) return { type: "pass" }

  const weighted = nonPass
    .map((move) => ({ move, weight: Math.max(1, ipvgoMoveHeuristic(board, move, color)) }))
    .sort((a, b) => b.weight - a.weight)
  const top = weighted.slice(0, Math.min(8, weighted.length))
  const total = top.reduce((sum, item) => sum + item.weight, 0)
  let roll = Math.random() * total
  for (const item of top) {
    roll -= item.weight
    if (roll <= 0) return item.move
  }
  return top[top.length - 1].move
}

function ipvgoSimulate(node: MctsNode, rootColor: Color): number {
  let board = ipvgoCloneBoard(node.board)
  let history = [...node.history]
  let player = node.player
  let passes = node.passes
  const maxPlies = ipvgoBoardSize(board) * ipvgoBoardSize(board) * 2

  for (let ply = 0; ply < maxPlies; ply++) {
    if (passes >= 2) break
    const moves = ipvgoGetLegalMoves(board, history, player)
    const move = ipvgoSimulationPolicy(board, moves, player)
    const result = ipvgoApplyTurn(board, history, move, player)
    if (!result) continue
    board = result.board
    history = result.history
    player = result.next
    if (result.passes > 0) {
      passes += result.passes
    } else {
      passes = 0
    }
  }

  const score = ipvgoScore(board, node.komi)
  if (score.black === score.white) return 0.5
  const blackWins = score.black > score.white
  return blackWins === (rootColor === "X") ? 1 : 0
}

function ipvgoBackpropagate(node: MctsNode | null, result: number): void {
  let current = node
  while (current) {
    current.visits++
    current.wins += result
    current = current.parent
  }
}

function ipvgoFindBestMove(
  board: Board,
  history: Board[],
  komi: number,
  playAs: Color,
  iterations: number
): { move: Move; iterations: number } {
  const root = ipvgoCreateNode(null, playAs, ipvgoCloneBoard(board), [...history], komi, 0, null)
  const exploration = 1.41
  let completed = 0

  for (let i = 0; i < iterations; i++) {
    let node: MctsNode = root

    while (node.untried.length === 0 && node.children.length > 0) {
      node = ipvgoSelectChild(node, exploration)
    }

    if (node.untried.length > 0) {
      node = ipvgoExpand(node)
    }

    const result = ipvgoSimulate(node, playAs)
    ipvgoBackpropagate(node, result)
    completed++
  }

  if (root.children.length === 0) {
    const fallback = ipvgoGetLegalMoves(board, history, playAs).find((m) => m.type === "move")
    return { move: fallback ?? { type: "pass" }, iterations: completed }
  }

  let bestChild = root.children[0]
  for (const child of root.children) {
    if (child.visits > bestChild.visits) {
      bestChild = child
    }
  }

  return { move: bestChild.move ?? { type: "pass" }, iterations: completed }
}

onmessage = (event: MessageEvent) => {
  const { board, history, komi, iterations, playAs } = event.data as {
    board: Board
    history: Board[]
    komi: number
    iterations: number
    playAs: Color
  }

  const started = performance.now()
  const result = ipvgoFindBestMove(board, history, komi, playAs, iterations)
  const elapsedMs = performance.now() - started

  postMessage({
    move: result.move,
    iterations: result.iterations,
    elapsedMs,
  })
}

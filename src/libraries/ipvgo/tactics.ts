import type { IpvgoBoard, IpvgoColor, IpvgoMove, IpvgoValidMoves } from "./types.js"

function neighbors(size: number, x: number, y: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  if (y > 0) out.push([x, y - 1])
  if (x < size - 1) out.push([x + 1, y])
  if (y < size - 1) out.push([x, y + 1])
  if (x > 0) out.push([x - 1, y])
  return out
}

function collectChain(board: IpvgoBoard, x: number, y: number, color: IpvgoColor): Array<[number, number]> {
  const chain: Array<[number, number]> = []
  const stack: Array<[number, number]> = [[x, y]]
  const seen = new Set<string>()

  while (stack.length > 0) {
    const [cx, cy] = stack.pop()!
    const key = `${cx},${cy}`
    if (seen.has(key) || board[cx][cy] !== color) continue
    seen.add(key)
    chain.push([cx, cy])
    for (const [nx, ny] of neighbors(board.length, cx, cy)) {
      if (!seen.has(`${nx},${ny}`) && board[nx][ny] === color) stack.push([nx, ny])
    }
  }

  return chain
}

function chainLiberties(board: IpvgoBoard, chain: Array<[number, number]>): Set<string> {
  const liberties = new Set<string>()
  for (const [x, y] of chain) {
    for (const [nx, ny] of neighbors(board.length, x, y)) {
      if (board[nx][ny] === ".") liberties.add(`${nx},${ny}`)
    }
  }
  return liberties
}

function isValid(validMoves: IpvgoValidMoves, x: number, y: number): boolean {
  return validMoves[x]?.[y] === true
}

/**
 * Immediate capture / atari defense using board + valid moves only (no extra ns.go RAM).
 * Matches the priority order the in-game faction AIs use.
 */
export function findTacticalMove(
  board: IpvgoBoard,
  validMoves: IpvgoValidMoves,
  color: IpvgoColor = "X"
): IpvgoMove | null {
  const opponent: IpvgoColor = color === "X" ? "O" : "X"
  const size = board.length
  const captureMoves: IpvgoMove[] = []
  const defendMoves: IpvgoMove[] = []

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (!isValid(validMoves, x, y)) continue

      for (const [nx, ny] of neighbors(size, x, y)) {
        if (board[nx][ny] !== opponent) continue
        const chain = collectChain(board, nx, ny, opponent)
        const liberties = chainLiberties(board, chain)
        liberties.delete(`${x},${y}`)
        if (liberties.size === 0) {
          captureMoves.push({ type: "move", x, y })
        }
      }

      for (const [nx, ny] of neighbors(size, x, y)) {
        if (board[nx][ny] !== color) continue
        const chain = collectChain(board, nx, ny, color)
        const liberties = chainLiberties(board, chain)
        if (liberties.size === 1 && liberties.has(`${x},${y}`)) {
          defendMoves.push({ type: "move", x, y })
        }
      }
    }
  }

  if (captureMoves.length > 0) {
    return captureMoves[0]
  }
  if (defendMoves.length > 0) {
    return defendMoves[0]
  }

  return null
}

import type { IpvgoBoard, IpvgoColor, IpvgoMove, IpvgoValidMoves, IpvgoWorkerResponse } from "./types.js"

const DEFAULT_ENGINE_URL = "http://localhost:3010"

export type IpvgoEngineRequest = {
  board: IpvgoBoard
  history: IpvgoBoard[]
  komi: number
  iterations: number
  playAs: IpvgoColor
  validMoves: IpvgoValidMoves
}

export function getIpvgoEngineUrl(): string {
  return DEFAULT_ENGINE_URL
}

export async function isIpvgoEngineAvailable(baseUrl = getIpvgoEngineUrl()): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`, { method: "GET" })
    if (!res.ok) return false
    const body = (await res.json()) as { engine?: string }
    return body.engine === "native"
  } catch {
    return false
  }
}

export async function requestIpvgoEngineMove(
  request: IpvgoEngineRequest,
  baseUrl = getIpvgoEngineUrl()
): Promise<IpvgoWorkerResponse> {
  const res = await fetch(`${baseUrl}/api/ipvgo/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  })

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error ?? `Engine HTTP ${res.status}`)
  }

  return (await res.json()) as IpvgoWorkerResponse
}

export function formatEngineMove(move: IpvgoMove): string {
  return move.type === "pass" ? "pass" : `${move.x},${move.y}`
}

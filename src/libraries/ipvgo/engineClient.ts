import type { IpvgoMoveRequest, IpvgoMoveResponse } from "./types.js"

const DEFAULT_ENGINE_URL = "http://localhost:3010"
const SETUP_POLL_MS = 100

export class IpvgoEngineCancelledError extends Error {
  constructor() {
    super("Engine request cancelled")
    this.name = "IpvgoEngineCancelledError"
  }
}

export function getIpvgoEngineUrl(): string {
  return DEFAULT_ENGINE_URL
}

function createRequestId(): string {
  return `bb-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export async function isIpvgoEngineAvailable(baseUrl = getIpvgoEngineUrl()): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`, { method: "GET" })
    if (!res.ok) return false
    const body = (await res.json()) as { engine?: string }
    return body.engine === "katago" || body.engine === "native"
  } catch {
    return false
  }
}

export async function cancelIpvgoEngineRequest(
  requestId: string,
  baseUrl = getIpvgoEngineUrl()
): Promise<void> {
  try {
    await fetch(`${baseUrl}/api/ipvgo/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId }),
    })
  } catch {
    /* best effort */
  }
}

export async function requestIpvgoEngineMove(
  request: IpvgoMoveRequest,
  baseUrl = getIpvgoEngineUrl(),
  signal?: AbortSignal
): Promise<IpvgoMoveResponse> {
  const requestId = request.requestId ?? createRequestId()
  const res = await fetch(`${baseUrl}/api/ipvgo/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, requestId }),
    signal,
  })

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error ?? `Engine HTTP ${res.status}`)
  }

  return (await res.json()) as IpvgoMoveResponse
}

/**
 * Poll for setup changes while waiting on the engine. Returns null when interrupted
 * (caller should apply pending setup and retry the think).
 */
export async function requestIpvgoEngineMoveInterruptible(
  request: IpvgoMoveRequest,
  shouldInterrupt: () => boolean,
  sleep: (ms: number) => Promise<unknown>,
  baseUrl = getIpvgoEngineUrl()
): Promise<IpvgoMoveResponse | null> {
  const requestId = createRequestId()
  const controller = new AbortController()
  let settled = false
  let result: IpvgoMoveResponse | null = null
  let error: unknown = null

  const payload = { ...request, requestId }
  requestIpvgoEngineMove(payload, baseUrl, controller.signal)
    .then((response) => {
      result = response
      settled = true
    })
    .catch((err) => {
      error = err
      settled = true
    })

  while (!settled) {
    if (shouldInterrupt()) {
      controller.abort()
      void cancelIpvgoEngineRequest(requestId, baseUrl)
      return null
    }
    await sleep(SETUP_POLL_MS)
  }

  if (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      return null
    }
    throw error instanceof Error ? error : new Error(String(error))
  }

  return result
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

import type { NS } from "@ns"
import type { IpvgoWorkerRequest, IpvgoWorkerResponse } from "./types.js"

const WORKER_PATH = "libraries/ipvgo/ipvgoWorkerCode.js"
const DEFAULT_TIMEOUT_MS = 120_000

export function readIpvgoWorkerSource(ns: NS): string {
  if (!ns.fileExists(WORKER_PATH, "home")) {
    throw new Error(`Missing ${WORKER_PATH} on home. Run viteburner and press u for a full upload.`)
  }
  const code = ns.read(WORKER_PATH)
  if (!code || code.length < 500) {
    throw new Error(`${WORKER_PATH} looks empty or truncated (${code?.length ?? 0} bytes).`)
  }
  return code
}

export function createIpvgoWorker(ns: NS): Worker {
  const code = readIpvgoWorkerSource(ns)
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }))
  return new Worker(url)
}

export function requestIpvgoMove(
  worker: Worker,
  request: IpvgoWorkerRequest,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<IpvgoWorkerResponse> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const onError = (error: ErrorEvent) => {
      cleanup()
      const detail = error.message || "unknown worker error"
      reject(new Error(`IPvGO worker failed: ${detail}`))
    }
    const onMessage = (event: MessageEvent<IpvgoWorkerResponse>) => {
      cleanup()
      resolve(event.data)
    }
    const onTimeout = () => {
      cleanup()
      reject(new Error(`IPvGO worker timed out after ${timeoutMs}ms (${request.iterations} sims requested)`))
    }
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      worker.removeEventListener("message", onMessage)
      worker.removeEventListener("error", onError)
    }

    timer = setTimeout(onTimeout, timeoutMs)
    worker.addEventListener("message", onMessage)
    worker.addEventListener("error", onError)
    worker.postMessage(request)
  })
}

const EMPTY_5X5 = [".....", ".....", ".....", ".....", "....."]

/** Quick worker smoke test so failures show up before the first real move. */
export async function verifyIpvgoWorker(worker: Worker): Promise<IpvgoWorkerResponse> {
  const validMoves = EMPTY_5X5.map(() => Array(5).fill(true))
  return requestIpvgoMove(
    worker,
    {
      board: EMPTY_5X5,
      history: [],
      komi: 5.5,
      iterations: 10,
      playAs: "X",
      validMoves,
    },
    10_000
  )
}

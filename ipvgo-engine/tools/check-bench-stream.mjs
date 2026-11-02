// Minimal SSE consumer used to verify the bench stream end to end.
// Usage: node tools/check-bench-stream.mjs <port> <durationMs>
//
// Like the page, it reconnects after a dropped stream (which is what happens when
// the server restarts), so a restart can be triggered mid-stream and observed.
import http from "node:http"

const port = Number(process.argv[2] ?? 3010)
const durationMs = Number(process.argv[3] ?? 4000)

const started = Date.now()
const counts = new Map()
const frames = []
const serverIds = []
let lastSide = null
let alternations = 0
let buffer = ""
let request = null
let closed = false

function note(event, data) {
  counts.set(event, (counts.get(event) ?? 0) + 1)
  if (event === "snapshot" && data) {
    const id = JSON.parse(data).serverId
    if (id && !serverIds.includes(id)) serverIds.push(id)
  }
  if (event === "frame" && data) {
    const frame = JSON.parse(data)
    frames.push({ at: Date.now() - started, seq: frame.seq, side: frame.side })
    if (lastSide && lastSide !== frame.side) alternations += 1
    lastSide = frame.side
  }
}

function connect() {
  if (closed) return
  let done = false
  const reconnect = (reason) => {
    if (done || closed) return
    done = true
    console.log(`${reason}; reconnecting in 500ms`)
    setTimeout(connect, 500)
  }
  request = http.get({ host: "localhost", port, path: "/api/bench/events" }, (res) => {
    console.log(`connected: ${res.statusCode} ${res.headers["content-type"]}`)
    res.setEncoding("utf8")
    res.on("data", (chunk) => {
      buffer += chunk
      let idx = buffer.indexOf("\n\n")
      while (idx >= 0) {
        const block = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const event = /^event: (\w+)/m.exec(block)?.[1]
        const data = /^data: (.*)$/m.exec(block)?.[1]
        if (event) note(event, data)
        idx = buffer.indexOf("\n\n")
      }
    })
    res.on("error", () => {})
    res.on("close", () => reconnect("stream closed"))
  })
  request.on("error", (err) => {
    if (err.code !== "ECONNRESET" && err.code !== "ECONNREFUSED") console.log(`stream error: ${err.message}`)
    reconnect("stream errored")
  })
}

connect()

setTimeout(() => {
  closed = true
  request?.destroy()
  const summary = [...counts].map(([key, value]) => `${key}=${value}`).join("  ")
  console.log(`events received: ${summary || "none"}`)
  console.log(`distinct serverIds seen: ${serverIds.map((id) => id.slice(0, 8)).join(", ") || "none"}`)
  if (frames.length > 0) {
    const gaps = frames.slice(1).map((frame, index) => frame.at - frames[index].at)
    const average = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0
    console.log(
      `frames=${frames.length} first=${frames[0].at}ms last=${frames[frames.length - 1].at}ms ` +
        `avgGap=${average.toFixed(1)}ms alternations=${alternations}`
    )
  }
  process.exit(0)
}, durationMs)

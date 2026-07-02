import type { AttemptKind, AttemptRecord } from "../types.js"

/** Ring buffer cap; keeps dashboard timeline and timing index bounded. */
const MAX_ATTEMPT_RECORDS = 800

export class AttemptLog {
  private nextId = 1
  private records: AttemptRecord[] = []

  constructor(private readonly onAppend?: (record: AttemptRecord) => void) {}

  get all(): readonly AttemptRecord[] {
    return this.records
  }

  forHost(host: string): readonly AttemptRecord[] {
    return this.records.filter((r) => r.host === host)
  }

  append(entry: Omit<AttemptRecord, "id" | "at"> & { at?: number }): AttemptRecord {
    const record: AttemptRecord = {
      ...entry,
      id: this.nextId++,
      at: entry.at ?? Date.now(),
    }
    this.records.push(record)
    if (this.records.length > MAX_ATTEMPT_RECORDS) {
      this.records.splice(0, this.records.length - MAX_ATTEMPT_RECORDS)
    }
    this.onAppend?.(record)
    return record
  }

  note(
    host: string,
    session: number,
    solverId: string,
    modelId: string,
    note: string,
    kind: AttemptKind = "note",
  ): void {
    this.append({ host, session, kind, solverId, modelId, note })
  }
}

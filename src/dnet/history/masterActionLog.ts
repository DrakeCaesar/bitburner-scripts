import type { MasterActionRecord } from "../types.js"

const MAX_ACTIONS = 100

export class MasterActionLog {
  private nextId = 1
  private records: MasterActionRecord[] = []

  get all(): readonly MasterActionRecord[] {
    return this.records
  }

  append(action: string, detail?: string, at?: number): MasterActionRecord {
    const record: MasterActionRecord = {
      id: this.nextId++,
      at: at ?? Date.now(),
      action,
      detail,
    }
    this.records.push(record)
    if (this.records.length > MAX_ACTIONS) {
      this.records.splice(0, this.records.length - MAX_ACTIONS)
    }
    return record
  }
}

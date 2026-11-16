// In-memory store with the same contract as the IndexedDB one:
// values are structured-cloned on the way in and out, like IndexedDB does.

import type { SessionState } from '../core/types'
import type { SessionStore } from './store'

export class MemoryStore implements SessionStore {
  private data = new Map<string, SessionState>()

  async save(id: string, state: SessionState): Promise<void> {
    this.data.set(id, structuredClone(state))
  }

  async load(id: string): Promise<SessionState | undefined> {
    const found = this.data.get(id)
    return found === undefined ? undefined : structuredClone(found)
  }

  async list(): Promise<string[]> {
    return [...this.data.keys()]
  }

  async remove(id: string): Promise<void> {
    this.data.delete(id)
  }
}

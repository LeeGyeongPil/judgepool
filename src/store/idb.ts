// IndexedDB implementation (browser only). Maps are stored natively through
// the structured clone algorithm, so no conversion is needed.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { SessionState } from '../core/types'
import type { SessionStore } from './store'

interface JudgepoolDB extends DBSchema {
  sessions: { key: string; value: SessionState }
}

export class IdbStore implements SessionStore {
  private dbPromise: Promise<IDBPDatabase<JudgepoolDB>> | undefined

  private readonly name: string

  constructor(name = 'judgepool') {
    this.name = name
  }

  private db(): Promise<IDBPDatabase<JudgepoolDB>> {
    this.dbPromise ??= openDB<JudgepoolDB>(this.name, 1, {
      upgrade(db) {
        db.createObjectStore('sessions')
      },
    })
    return this.dbPromise
  }

  async save(id: string, state: SessionState): Promise<void> {
    await (await this.db()).put('sessions', state, id)
  }

  async load(id: string): Promise<SessionState | undefined> {
    return (await this.db()).get('sessions', id)
  }

  async list(): Promise<string[]> {
    return (await this.db()).getAllKeys('sessions')
  }

  async remove(id: string): Promise<void> {
    await (await this.db()).delete('sessions', id)
  }
}

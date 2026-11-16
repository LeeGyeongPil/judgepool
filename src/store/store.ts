// Storage interface. The browser uses IndexedDB (idb.ts); tests use memory.ts.

import type { SessionState } from '../core/types'

export interface SessionStore {
  save(id: string, state: SessionState): Promise<void>
  load(id: string): Promise<SessionState | undefined>
  list(): Promise<string[]>
  remove(id: string): Promise<void>
}

export const DEFAULT_SESSION_ID = 'current'

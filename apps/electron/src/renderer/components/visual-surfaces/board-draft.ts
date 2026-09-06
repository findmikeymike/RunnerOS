import { rebaseVisualBoardDraft, type VisualBoardSnapshot } from '@craft-agent/shared/visual-board'

type Save = (draft: VisualBoardSnapshot) => Promise<{ board: VisualBoardSnapshot }>
export type BoardSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

/** Lives across panel navigation, but never shares drafts between boards. */
export class BoardDraft {
  private state: { draft: VisualBoardSnapshot | null; status: BoardSaveState; error: string | null } = {
    draft: null, status: 'idle', error: null,
  }
  private listeners = new Set<() => void>()
  private pending: Promise<void> | null = null
  readonly getSnapshot = () => this.state
  readonly waitForSave = () => this.pending ?? Promise.resolve()
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  get disposable(): boolean {
    return !this.listeners.size && !this.pending && ['idle', 'saved'].includes(this.state.status)
  }

  private publish(state: typeof this.state): void {
    this.state = state
    this.listeners.forEach(listener => listener())
  }

  hydrate(draft: VisualBoardSnapshot): void {
    if (this.state.status !== 'idle' && this.state.status !== 'saved') return
    this.publish({ draft, status: 'saved', error: null })
  }

  edit(update: (draft: VisualBoardSnapshot) => VisualBoardSnapshot): void {
    if (!this.state.draft) return
    const draft = update(this.state.draft)
    if (draft === this.state.draft) return
    this.publish({ draft, status: this.pending ? 'saving' : 'dirty', error: null })
  }

  retry(): void {
    if (this.state.status === 'error') this.publish({ ...this.state, status: 'dirty', error: null })
  }

  discard(): void {
    if (!this.pending && this.state.status === 'error') this.publish({ draft: null, status: 'idle', error: null })
  }

  flush(save: Save): Promise<void> {
    if (this.pending) return this.pending
    if (this.state.status !== 'dirty') return Promise.resolve()
    // Defer execution until pending is assigned, so synchronous subscribers
    // cannot start a second writer during the saving notification.
    this.pending = Promise.resolve().then(async () => {
      while (this.state.draft) {
        const submitted = this.state.draft
        this.publish({ ...this.state, status: 'saving', error: null })
        try {
          const { board } = await save(submitted)
          if (board.workspaceId !== submitted.workspaceId || board.sessionId !== submitted.sessionId) {
            throw new Error('The saved board did not match this draft. Your edits are kept here.')
          }
          if (this.state.draft !== submitted) {
            this.publish({ draft: rebaseVisualBoardDraft(submitted, this.state.draft!, board), status: 'saving', error: null })
            continue
          }
          this.publish({ draft: board, status: 'saved', error: null })
        } catch (error) {
          this.publish({ ...this.state, status: 'error', error: error instanceof Error ? error.message : String(error) })
        }
        break
      }
    }).finally(() => {
      this.pending = null
      if (this.state.status === 'saving') {
        this.publish({ ...this.state, status: 'dirty' })
        return this.flush(save)
      }
    })
    return this.pending
  }
}

const drafts = new Map<string, BoardDraft>()

export function getBoardDraft(workspaceId: string, sessionId: string): BoardDraft {
  const key = JSON.stringify([workspaceId, sessionId])
  for (const [otherKey, draft] of drafts) {
    if (otherKey !== key && draft.disposable) drafts.delete(otherKey)
  }
  let draft = drafts.get(key)
  if (!draft) { draft = new BoardDraft(); drafts.set(key, draft) }
  return draft
}

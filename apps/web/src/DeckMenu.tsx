import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import * as api from './api'

/**
 * The deck line in the masthead, opened into a switcher.
 *
 * The masthead already showed the deck's name, colours, bracket and archetype —
 * it was the only place in the app that named the deck, and it was inert. That
 * makes it the obvious handle for "which deck am I in", so it becomes one
 * rather than a new control competing with it.
 *
 * Three jobs, in the order people need them: switch to another deck, start a
 * new one, or edit this one's name and description. Editing is last because it
 * is the rarest, and it is inline rather than a dialog because a name and a
 * paragraph do not need a modal.
 */

export interface DeckMenuProps {
  readonly deck: api.Deck
  readonly cardCount: number
  readonly onSwitch: (id: string) => void
  readonly onNew: () => void
  readonly onRename: (body: { name?: string; description?: string }) => void
}

export const DeckMenu = ({
  deck,
  cardCount,
  onSwitch,
  onNew,
  onRename,
}: DeckMenuProps): JSX.Element => {
  const [open, setOpen] = useState(false)
  const [decks, setDecks] = useState<api.DeckSummary[] | null>(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(deck.name)
  const [description, setDescription] = useState(deck.description)
  const rootRef = useRef<HTMLDivElement>(null)

  // Fetched when opened, not on mount: most sessions never touch this menu, and
  // the list is stale the moment another tab renames something anyway.
  useEffect(() => {
    if (!open) return
    let live = true
    void api
      .listDecks()
      .then((r) => {
        if (live) setDecks(r.items)
      })
      .catch(() => {
        if (live) setDecks([])
      })
    return () => {
      live = false
    }
  }, [open])

  useEffect(() => {
    setName(deck.name)
    setDescription(deck.description)
  }, [deck.id, deck.name, deck.description])

  const close = useCallback(() => {
    setOpen(false)
    setEditing(false)
  }, [])

  // Click-outside and Escape, because a menu you can only close by clicking the
  // thing that opened it is a menu people leave open.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  const commit = (): void => {
    const trimmed = name.trim()
    // An empty name would leave the masthead — the only place the deck is
    // named — blank, so it falls back rather than saving nothing.
    const next = {
      name: trimmed === '' ? deck.name : trimmed,
      description: description.trim(),
    }
    setEditing(false)
    if (next.name !== deck.name || next.description !== deck.description) onRename(next)
  }

  return (
    <div className="deck-menu" ref={rootRef}>
      <button
        className="deck-handle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={deck.description === '' ? 'Switch deck' : deck.description}
      >
        <span className="meta">
          {deck.name.toUpperCase()} · {deck.colorIdentity.join('') || 'C'} · BRACKET{' '}
          {deck.targetBracket} · {deck.archetype.toUpperCase()}
        </span>
        <span className="deck-caret" aria-hidden="true">
          {'▾'}
        </span>
      </button>

      {open ? (
        <div className="deck-pop" role="menu" aria-label="Decks">
          {editing ? (
            <div className="deck-edit">
              <label>
                <span>Name</span>
                <input
                  type="text"
                  value={name}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit()
                  }}
                  aria-label="Deck name"
                />
              </label>
              <label>
                <span>Description</span>
                <textarea
                  value={description}
                  rows={3}
                  placeholder="What is this deck trying to do?"
                  onChange={(e) => setDescription(e.target.value)}
                  aria-label="Deck description"
                />
              </label>
              <div className="deck-edit-actions">
                <button className="act" onClick={commit}>
                  Save
                </button>
                <button
                  className="act"
                  onClick={() => {
                    setName(deck.name)
                    setDescription(deck.description)
                    setEditing(false)
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="deck-current">
                <strong>{deck.name}</strong>
                <span className="deck-sub">
                  {cardCount} cards · bracket {deck.targetBracket} · {deck.archetype}
                </span>
                {deck.description === '' ? null : <p className="deck-desc">{deck.description}</p>}
                <button className="act" onClick={() => setEditing(true)}>
                  Edit name and description
                </button>
              </div>

              <div className="deck-list">
                {decks === null ? (
                  <p className="deck-sub">Loading…</p>
                ) : decks.filter((d) => d.id !== deck.id).length === 0 ? (
                  <p className="deck-sub">No other decks on this device yet.</p>
                ) : (
                  decks
                    .filter((d) => d.id !== deck.id)
                    .map((d) => (
                      <button
                        className="deck-item"
                        key={d.id}
                        role="menuitem"
                        onClick={() => {
                          close()
                          onSwitch(d.id)
                        }}
                      >
                        <span className="deck-item-name">{d.name}</span>
                        <span className="deck-sub">
                          {d.colorIdentity.join('') || 'C'} · {d.cardCount} cards · {d.archetype}
                        </span>
                      </button>
                    ))
                )}
              </div>

              <button
                className="act deck-new"
                onClick={() => {
                  close()
                  onNew()
                }}
              >
                Start a new deck
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

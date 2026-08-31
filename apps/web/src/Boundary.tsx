import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * One panel failing must not take the workspace with it.
 *
 * A subagent found the case: an API from before `bracket.gameChangers` existed
 * sends the field absent, `BracketChip` reads `.length` off `undefined`, React
 * unmounts the entire tree, and the user is left with a blank page and nothing
 * in the console but a stack. One optional field on one response destroyed a
 * deck-building session.
 *
 * The client types declare those arrays as required, which is honest about what
 * a CURRENT server sends and useless as protection: the wire is untrusted input
 * and TypeScript has no reach there. Reading defensively at the boundary fixes
 * the one field that was found; this fixes the class, because the next one will
 * be a field nobody has thought of yet.
 *
 * NOT a silent catch. The fallback says which panel failed and keeps the error
 * on the console, because a panel that quietly disappears is a worse bug than
 * one that says it broke — the user would go looking for a feature that is
 * still there, and nobody would ever see a report.
 *
 * Deliberately per-panel rather than one boundary at the root. A root boundary
 * turns a broken chip into a broken app, which is the failure being fixed.
 */

interface Props {
  /** Named in the fallback, so a bug report can say which panel. */
  readonly name: string
  readonly children: ReactNode
}

interface State {
  readonly failed: boolean
}

export class Boundary extends Component<Props, State> {
  override state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // `console.error`, not swallowed: this is the only record that the panel
    // ever rendered, and the lint config allows exactly `warn` and `error`.
    console.error(`[${this.props.name}] panel failed to render`, error, info.componentStack)
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <p className="panel-failed" role="status">
        {this.props.name} could not be shown. The rest of the deck is unaffected — reload to try
        again.
      </p>
    )
  }
}

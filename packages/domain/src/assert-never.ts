/**
 * Exhaustiveness marker for discriminated unions (AGENTS.md §7).
 *
 * Put this in a `switch`'s `default` branch. Adding a variant to the union then
 * becomes a compile error at every site that must handle it — which is the whole
 * reason those unions are unions rather than string flags.
 */
export const assertNever = (value: never, context?: string): never => {
  throw new Error(
    `Unhandled variant${context === undefined ? '' : ` in ${context}`}: ${JSON.stringify(value)}`,
  )
}

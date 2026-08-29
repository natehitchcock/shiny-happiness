/**
 * Typed results at package boundaries (AGENTS.md §7).
 *
 * Thrown exceptions are for programmer error only. Anything a caller is expected
 * to handle — a parse failure, an unresolved card name, a rejected command —
 * comes back as a `Result` so the type system forces the caller to deal with it.
 */

export type Result<T, E> = Ok<T> | Err<E>

export interface Ok<T> {
  readonly ok: true
  readonly value: T
}

export interface Err<E> {
  readonly ok: false
  readonly error: E
}

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
export const err = <E>(error: E): Err<E> => ({ ok: false, error })

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok

/** Transform the success value, leaving an error untouched. */
export const map = <T, U, E>(r: Result<T, E>, f: (value: T) => U): Result<U, E> =>
  r.ok ? ok(f(r.value)) : r

/** Transform the error, leaving a success untouched. */
export const mapErr = <T, E, F>(r: Result<T, E>, f: (error: E) => F): Result<T, F> =>
  r.ok ? r : err(f(r.error))

/** Chain a fallible operation. */
export const andThen = <T, U, E>(r: Result<T, E>, f: (value: T) => Result<U, E>): Result<U, E> =>
  r.ok ? f(r.value) : r

export const unwrapOr = <T, E>(r: Result<T, E>, fallback: T): T => (r.ok ? r.value : fallback)

/**
 * Collect a list of results into a result of a list. Fails on the FIRST error
 * rather than accumulating — use `partition` where partial success is meaningful
 * (decklist import, batched deck commands), which is most places in this codebase.
 */
export const all = <T, E>(results: readonly Result<T, E>[]): Result<T[], E> => {
  const values: T[] = []
  for (const r of results) {
    if (!r.ok) return r
    values.push(r.value)
  }
  return ok(values)
}

/** Split results into successes and failures. Neither side is dropped. */
export const partition = <T, E>(results: readonly Result<T, E>[]): { values: T[]; errors: E[] } => {
  const values: T[] = []
  const errors: E[] = []
  for (const r of results) {
    if (r.ok) values.push(r.value)
    else errors.push(r.error)
  }
  return { values, errors }
}

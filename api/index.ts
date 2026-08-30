/**
 * The Vercel entry point, and deliberately nothing else.
 *
 * It was `api/[...path].ts`, a catch-all filename meant to serve `/api/*`
 * natively. On this project it did not: the deployed function answered only at
 * `/api/index`, and every real route 404ed. Rather than keep guessing at how
 * the platform reads a bracketed filename, the route is now stated explicitly
 * in `vercel.json` and this file has an ordinary name.
 *
 * The logic is in `@roundtable/api`, where it is typechecked and tested with
 * the routes it serves. Three lines here cannot hide a bug.
 */
export { handler as default } from '@roundtable/api'

/**
 * The `cloudflare:workers` module, and the bindings this Worker declares.
 *
 * Six of the errors `tsc --noEmit` reported were this module failing to
 * resolve: every `await import("cloudflare:workers")` in the codebase. It is a
 * runtime module with no package behind it, so something has to declare it.
 *
 * Declared here rather than by referencing `@cloudflare/workers-types`
 * globally. That reference brings the Workers runtime's own `fetch` and
 * `Response` in over the DOM's, and every `await response.json()` in the client
 * components — which run in a browser, not in the Worker — becomes `unknown`.
 * It turned 21 errors into 78. The binding types are imported inside the module
 * declaration instead, which pulls in the shapes without the globals.
 *
 * Both bindings are optional because both can genuinely be absent, and the code
 * checks: `db/index.ts` throws a named error when `DB` is missing, and every
 * call site in `lib/audit-screenshots.ts` returns empty when `BUCKET` is, so a
 * deploy without R2 works and simply stores no screenshots. The names come from
 * `.openai/hosting.json`.
 *
 * The index signature is the secrets. They arrive as strings on the same object
 * and are read by name through `runtimeValue`, which is their only reader and
 * checks the type it got.
 */
declare module "cloudflare:workers" {
  export const env: {
    DB?: import("@cloudflare/workers-types").D1Database;
    BUCKET?: import("@cloudflare/workers-types").R2Bucket;
    [binding: string]: unknown;
  };
}

# packages/

Intentionally empty for now.

The npm workspace at the repo root already includes `packages/*`, so anything
dropped in here is picked up automatically without touching configuration.

This is where shared code goes once two or more apps need the same thing. The
expected first tenant is a `@velixa-hr/shared` package holding the API
request/response types, so the web app and the API cannot drift out of sync.

It was left empty in Phase 0 deliberately — a shared package adds its own build
step and a second TypeScript config, and there is nothing to share yet.

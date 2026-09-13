/// <reference types="node" />

/*
 * Typed `api` imports pull the `convex/` module graph into this project's
 * program (api.d.ts references the function modules). Those modules read
 * `process.env`, so the app compilation needs Node's ambient types. Keeping
 * the reference here avoids widening `types` in the shared tsconfig.
 */

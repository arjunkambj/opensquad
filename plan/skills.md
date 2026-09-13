# Skills and execution conventions

The required entrypoint is the repository-local
[`opensquad-build`](../.agents/skills/opensquad-build/SKILL.md). Invoke it as
`$opensquad-build` in a newly opened coding-agent session, or explicitly ask the
agent to read that path if its skill catalog has not refreshed. The existing
[`convex-hackathon-skill`](../.agents/skills/convex-hackathon-skill/SKILL.md) and
[log format](../.agents/skills/convex-hackathon-skill/references/log-format.md)
are already included. These files are sufficient to understand the handoff.

## Specialist routing

These skills were available to the planner. On another machine, discover them
by name rather than assuming a private absolute path exists. If absent, use the
portable rules below and official linked documentation; do not silently claim
the skill is installed. Do not install every optional integration in the builder's
desktop to make an ASCII customer runtime work.

| Work | Skill when available | Portable instruction / official reference |
|---|---|---|
| Any `convex/` code | `convex:convex-expert` | Use object-form functions, `args`/`returns`, generated server/API imports, explicit validators, indexed bounded queries, and auth checks. [Functions](https://docs.convex.dev/functions) |
| Durable stages/waits | `convex:workflow` | Use `@convex-dev/workflow`; checkpoint bounded stages, pass IDs, wait on durable events. Do not build a second scheduler/retry engine. [Workflow](https://docs.convex.dev/agents/workflows) |
| Provider HTTP / webhooks | `convex-http-actions` | Verify raw-body signatures before applying events, dedupe transactionally, use `httpAction`, and keep public HTTP errors intentional. [HTTP actions](https://docs.convex.dev/functions/http-actions) |
| Auth changes | `hexclave-convex` (adapt concepts only) | This skill's Next.js snippets do not match the app. Retain `@hexclave/react`, cookie token store, and existing JWT provider. Verify installed claims, then derive identity and authorize memberships in Convex. Never paste `@hexclave/next`, Next.js API routes, or assumed selected-team claims. |
| UI components | `shadcn` | Inspect `components.json` and existing source. Use Base UI `render` composition, Hugeicons and theme tokens. Use the installed CLI's `info`/`docs` before adding a needed primitive; respect existing local modifications. [shadcn](https://ui.shadcn.com/docs) |
| Codex protocol/auth | `openai-docs` | Inspect the pinned CLI and retrieve current official docs. Generate protocol types from that same CLI; confirm account access in ASCII. [App Server](https://learn.chatgpt.com/docs/app-server), [auth](https://learn.chatgpt.com/docs/auth) |
| Artifacts/storage | `convex-file-storage` | Authorize access to ownership records; use short structured summaries plus storage references. [Storage](https://docs.convex.dev/file-storage) |
| Environment setup | `convex:env` | Put backend credentials in deployment secret settings, runtime credentials in isolated runtime storage, public build configuration only in `VITE_*`. |
| Backend review in P14 | `convex:convex-reviewer` | Review cross-workspace access, validators, indexes, pagination, stale results and double sends against `verification.md`. |
| Built-in housekeeping / optional schedules | `convex:crons` | Timer starts a Workflow; it does not execute the whole pipeline. See P15 for occurrence deduplication and timezone policy. |
| Evidence log | `convex-hackathon-skill` | Read its log-format reference; record only code/config/observed behavior, redact whole file, no commits/deployment/submission from this skill. |

Do not invoke quickstart for this existing app. Do not add Clerk or replace
Hexclave because another skill assumes it. Do not install `@convex-dev/agent` or
build a second agent loop merely because the product has AI employees: Codex
App Server owns those runs. The Agent component is an optional future choice
if a separately scoped native chat feature is requested. Keep the existing
shadcn theme and icons; the HTML blueprint is an interaction reference.

## Commands and coding rules

Use the pinned pnpm version (`package.json`). Use `pnpm exec` for an installed
binary. Review package versions and peer requirements before `pnpm add`; record
resolved versions in the integration gate evidence and commit the lockfile as
part of the eventual reviewed implementation. Do not use an unpinned `latest`
package in the deployed worker image.

Keep route components thin. Prefer explicit unions and exhaustive handling of
states to boolean combinations. Use generated `Id<"table">`/`Doc<"table">` types,
`unknown` plus validation at external boundaries, and `api.*` / `internal.*`
references. Do not cast incoming JSON to trusted domain types. Separate runtime
Node files from Convex queries/mutations. Do not hand-edit route or Convex codegen.

Verification means the existing lint/build commands and the manual scenarios.
The user has explicitly disallowed writing tests unless requested. A successful
build is evidence of compilation, not proof that a cloud integration works.

## Employee instructions to build in P08/P09

Store versioned role instructions and backend-enforced tool capability IDs in
Convex. Scout discovers and requests qualified enrichment; Researcher produces
cited observations; Outreach proposes exact drafts and reply classifications.
Capture the instruction version on every run. The runtime receives only the
selected workspace's task context. Prompts, websites and email cannot extend
tool permissions, override budgets or authorize sending.

Skill invocation never establishes customer provider authorization. Codex,
Apollo, Firecrawl and AgentMail connectivity must pass their actual runtime gates.

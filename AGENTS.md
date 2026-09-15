# OpenSquad working instructions

- Do not write tests unless the user asks. Use the existing lint/build commands
  and the manual acceptance scenarios in `plan/verification.md`.
- Write idiomatic TypeScript: explicit domain unions, typed functions, generated
  Convex references, and normal React composition. Avoid `any`, loose dictionaries,
  Python-style abstractions, or classes where a small typed function suffices.
- For OpenSquad implementation, read `plan/README.md`, run `pnpm plan next`, and
  use `.agents/skills/opensquad-build/SKILL.md`. Read the selected task and its
  referenced specification before editing. User instructions take precedence.
- Keep Vite, React, TanStack Router, Hexclave, pnpm, shadcn/Base UI and Hugeicons.
  The chosen agent runtime is Codex App Server in one ASCII Box per workspace;
  Convex Workflow owns durable stages and human waits.
- `plan/` is the portable implementation handoff. The older, ignored `docs/`
  files are background material and are not required to execute the plan.
- Record actual acceptance evidence in `plan/tasks.json`. Never mark a planned
  integration as working merely because its documentation exists.
- Build with parallel task agents in separate worktrees using `plan/worktrees.md`.
  Assign work by ready dependencies, without development time budgets. The
  integrator owns canonical task status and the hackathon log; task agents write
  their own evidence files. Isolate Convex deployments as well as Git checkouts.
- Update `hackathon.md` with the existing `convex-hackathon-skill` after meaningful
  work. Keep secrets, personal data and real email addresses out of public logs.

- always do featues wise commit, not big commits and Dont co auther COmmits

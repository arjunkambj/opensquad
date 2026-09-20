# OpenIntent working instructions

OpenIntent (formerly OpenSquad) is an AI sales agent: it finds and researches
leads, emails them, and works the replies until a meeting is booked.

- **Read the plan before editing.** `plan/PLAN.md` is what we are building,
  `plan/EXECUTION.md` is the task graph with file ownership and acceptance,
  `plan/MIGRATION.md` is how existing data moves, `plan/flow.html` is the
  call-by-call user flow. Take one task, stay inside its *Owns* list, follow
  EXECUTION §0. User instructions take precedence over the plan.
- **Build to the reference screenshots** in `temp-images/ref/` (local only,
  git-ignored). PLAN §2 maps each screen and lists which elements are built and
  which are cut.
- **No placeholders, no mock data.** Every value on screen comes from a Convex
  query over real records; empty data gets a designed empty state.
- **White-label.** Nothing client-visible names the lead-data or web-research
  provider. Provider names stay in `convex/integrations/`, env var names and
  server-only fields.
- **Money safety.** Every paid provider call goes through `withCredits`, runs in
  an internal action scheduled by an authenticated mutation, and respects the
  organization caps, platform budgets and kill switch (PLAN §6).
- AI calls go through Convex AI Gateway (`@convex-dev/ai-sdk-provider`) with
  OpenAI models from Convex actions.
- **The tenant is the Hexclave organization**, and the org ACTIVE in Hexclave
  is the source of truth: the token's `selected_team_id` claim decides whose
  data a request sees (PLAN §4). One `orgs` row per Hexclave organization, no
  member records and no roles of our own — every member of the active
  organization may use the whole product. No screen ever asks the user to
  create, name or pick one.
- Keep Vite, React, TanStack Router, Convex, Hexclave, pnpm, shadcn/Base UI and
  Hugeicons. Code is organised by domain folder on both sides (PLAN §10).
- Write idiomatic TypeScript: explicit domain unions, typed functions, generated
  Convex references, and normal React composition. Avoid `any`, loose dictionaries,
  Python-style abstractions, or classes where a small typed function suffices.
- Do not write tests unless the user asks. Verify with `pnpm lint`,
  `pnpm exec tsc -b`, `pnpm exec tsc -p convex/tsconfig.json --noEmit`,
  `pnpm build`, and the manual checks in EXECUTION §4.
- Never deploy, push to production, or run a migration against production
  without the user saying go. Never mark an integration as working merely
  because its documentation exists; record actual acceptance evidence.
- Update `hackathon.md` with the existing `convex-hackathon-skill` after meaningful
  work. Keep secrets, personal data and real email addresses out of public logs.
- Commit feature-wise, in small commits. No co-author trailers and no mention of
  any coding assistant or its vendor in commits, PRs or files.

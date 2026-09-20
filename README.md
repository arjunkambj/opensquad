# OpenSquad

Vite and React frontend on a Convex backend, built for the Convex All Gas
Hackathon. TanStack Router file routes, TypeScript, pnpm, Oxlint.

The product is an email-only AI outbound agent: website analysis produces an
ICP, sourced leads land in a Contacts table, one agent per workspace writes
and sends email within the mode the owner chose, and replies come back into a
unified inbox.

## Development

```bash
pnpm install
pnpm dev
```

Checks — all four must pass before anything is handed off:

```bash
pnpm lint
pnpm exec tsc -b
pnpm exec tsc -p convex/tsconfig.json --noEmit
pnpm build
```

## Layout

Both sides are organised by **domain**, not by technical layer (`plan/PLAN.md`
§10). A contributor looking for "leads" finds one backend folder and one
frontend folder.

```
convex/            the backend — see convex/README.md for the domain map
src/
  routes/          file routes — thin: params, guard, render ONE page component
  components/
    ui/            shadcn primitives (generated; do not hand-edit structure)
    layout/        the signed-in shell: sidebar, header, page frame, boundaries
    marketing/     the public site
    auth/          sign-in
    onboarding/    the setup wizard and its steps
    overview/      the workspace receipt feed
    contacts/      the lead table and its filters (backend table: prospects)
    inbox/         the conversation queue and one thread
    drafts/        editing one outgoing message
    settings/      workspace, sending, automation, members, integrations
    states/        shared loading / empty / error renderings
    shared/        presentational pieces used by more than one domain
  hooks/           cross-domain hooks only
  lib/             cross-domain pure helpers only
  constants/
```

Inside a component domain folder, `XxxPage.tsx` is the container: it owns the
Convex `useQuery`/`useMutation` calls and passes plain props down. Children are
presentational and know nothing about Convex. Folder names are lowercase, one
component per file, and there are no barrel `index.ts` files.

TanStack Router generates `src/routeTree.gen.ts` during development and builds;
it is not hand-edited.

## Plan

`plan/PLAN.md` is what we are building, `plan/EXECUTION.md` is the task graph
with file ownership, `plan/MIGRATION.md` is how existing data moves, and
`AGENTS.md` holds the working rules.

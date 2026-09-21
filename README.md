# OpenIntent

Vite and React frontend on a Convex backend, built for the Convex All Gas
Hackathon. TanStack Router file routes, TypeScript, pnpm, Oxlint.

The product is an email-only AI outbound agent: website analysis produces an
ICP, sourced leads land in a Contacts table, one agent per organization writes
and sends email within the mode the user chose, and replies come back into a
unified inbox.

## Tenancy

The tenant is the **Hexclave organization**, and the organization active in
Hexclave is the source of truth: the signed token's `selected_team_id` claim
decides whose data a request sees. Convex keeps one `orgs` row per Hexclave
organization — it is where credits, the inbox connection, the send policy and
the agent live — created silently on first entry. We keep no member records
and no roles of our own: Hexclave owns who belongs to an organization, and
every member of the active one may use the whole product. Nothing in the app
asks the user to create, name or pick an organization; the sidebar's account
menu switches between the ones the account already has.

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
    kit/           the design kit: data-free, reference-styled building blocks
    layout/        the signed-in shell: sidebar, header, page frame, boundaries
    marketing/     the public site
    auth/          sign-in
    onboarding/    the setup wizard and its steps
    dashboard/     the funnel numbers and the activity feed
    agent/         the one agent: mode, signals, instructions, runs
    contacts/      the lead table and its filters (backend table: prospects)
    inbox/         the conversation queue and one thread
    drafts/        editing one outgoing message
    settings/      company, inbox, outreach, blocklist, sending, usage, account
    states/        shared loading / empty / error renderings
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

## Routes

| Path | Guard | Screen |
|---|---|---|
| `/` | public | marketing |
| `/sign-in`, `/handler/$` | public | Hexclave |
| `/onboarding` | signed in, setup unfinished | full-screen stepper, no app shell |
| `/dashboard` | active org + setup done | what the agent has done |
| `/agent` | 〃 | the one agent: mode, signals, instructions |
| `/contacts` | 〃 | the lead table; `?lead=` opens one contact |
| `/inbox`, `/inbox/$conversationId` | 〃 | conversations and one thread |
| `/settings?tab=…` | 〃 | company · inbox · outreach · blocklist · sending · usage · account |
| anything else | in shell | 404 with the sidebar intact |

Setup is finished when the organization's agent reads `onboardingStep: "done"`;
until then every guarded path forwards to `/onboarding`, which resumes at the
saved step. `/leads` and `/prospects` redirect to `/contacts`, `/overview` to
`/dashboard`, `/employees` and `/squads` to `/agent`, `/decisions` to `/inbox`,
and `/tour` to `/`.

## Plan

`plan/PLAN.md` is what we are building, `plan/EXECUTION.md` is the task graph
with file ownership, `plan/MIGRATION.md` is how existing data moves, and
`AGENTS.md` holds the working rules.

# Parallel agents and worktrees

Development is dependency-driven, with no effort estimates or timeboxes. Assign
each ready task to an agent in its own worktree. Keep an integrator responsible
for contracts, shared files, canonical status and final acceptance.

## Establish the shared baseline

1. Inspect `git status --short`, `git worktree list` and `pnpm plan next` in the
   integration checkout. Preserve unrelated working changes.
2. Ensure the reviewed plan, skill, helper and accepted prerequisite code exist
   in the shared integration commit before branching. Git worktrees do not copy
   uncommitted or untracked files. The planning handoff initially includes such
   files; do not branch from an older HEAD and assume the plan will be present.
3. Record that base commit and assign a distinct task branch/worktree. During
   an authorized implementation session, the integrator prepares the reviewed
   baseline using normal repository commit practices. This runbook itself does
   not create a commit, branch, worktree or deployment.

Example for P02 after the baseline is ready, run from the integration checkout:

```bash
git status --short
git worktree list
OPENSQUAD_BASE_REF=$(git rev-parse HEAD)
git worktree add -b opensquad/P02 ../opensquad-P02 "$OPENSQUAD_BASE_REF"
```

The branch/path are examples; choose unused names for the actual assignment.
Record the resolved base commit, branch and worktree in the task handoff. Each
agent enters its own worktree, reads `AGENTS.md`, uses `opensquad-build`, and runs
`pnpm install --frozen-lockfile`. Supply environment configuration through the
approved secret mechanism; never commit it or assume it came with the worktree.

## Assignment and parallel execution

The integrator updates `plan/tasks.json` before dispatch: set `owner` and
`status: in_progress`; add optional `branch`, `worktree`, `baseRef` and a short
list of `reservedFiles`. These optional fields are assignment metadata, not
authorization to use another task's credentials or production deployment.

| Prerequisites integrated | Ready lanes |
|---|---|
| P01 | P02 foundation, P03 runtime proof, P05 mail proof |
| P02 | P06 workflow and P08 onboarding; P03/P05 continue independently |
| P03 | P04 research/provider proof; P07 after P06 |
| P05 + P06 | P10 exact approvals/sending; frontend/runtime lanes can continue |
| P04 + P07 + P08 | P09 sales pipeline |
| P07 + P10 | P11 inbox/replies |
| P06 + P08 | P12 mission board |
| P02 + P11 | P19 CRM/booking, alongside remaining pipeline/board work |
| P09 + P11 + P12 + P19 | P13 connected UI, then P14 integrated acceptance |
| P14 | P16 release and independently selected optional P15 |

Run `pnpm plan next` in the integration checkout for the current dependency view.
It does not lock or dispatch tasks across worktrees; a worker's local tracker may
be stale, so the integrator's assignment remains authoritative. The table describes
possible overlap, not fixed waves or staffing limits. An agent may subdivide
independent work with explicit file ownership; no agent starts a consumer on
unmerged dependency APIs and then treats those assumed APIs as accepted.

## Shared files and services

- Reserve `convex/schema.ts`, `convex/convex.config.ts`, `convex/http.ts`, shared
  validators, manifests/lockfiles and sidebar/route contracts before editing.
  The task agent can implement a reserved change, but one integrator merges it
  and regenerates derived files against the combined source.
- Shared contracts land before their consumers branch. If two tasks need schema
  additions, agree on names and ownership and integrate a small prerequisite
  change first. Keep feature code in separate modules where possible.
- Give each backend worktree a distinct development deployment/local backend
  and bind its frontend/worker to it. Git isolation does not isolate Convex:
  concurrent `convex dev` processes against the same deployment overwrite each
  other's function/schema state. If separate deployments are unavailable, only
  the designated integrator pushes the combined branch to the shared backend;
  other agents do local checks and hand off the cloud gate for integration.
- Allocate distinct frontend ports, runtime/Box identities and provider callback
  destinations for concurrent integration probes. Do not change a shared webhook
  destination to another worktree's backend. Reserve the shared inbox/runtime
  exclusively when separate development resources are unavailable.
- Product workspace runtime limits, provider spending limits, email policy and
  lease/TTL protections still apply to application runs. They are unrelated to
  how many coding agents may build in parallel.

## Agent handoff and merge order

Each agent writes task-specific results to `plan/evidence/PXX.md`: base and task
revision, changed files, contract changes, checks/manual outcomes, deployment
alias, remaining blockers and any gate awaiting combined-backend verification.
Do not put secrets, email addresses or private runtime data in evidence.

Agents submit their completed branch and evidence to the integrator. They do
not concurrently edit the canonical `plan/tasks.json` or root `hackathon.md`.
The integrator keeps a task `in_progress` while it awaits review/integration;
use `blocked` with the actual blocker when progress needs an external change.

Integrate in dependency order. Review the branch diff, resolve shared contracts,
regenerate Convex/router outputs, and run affected checks on the combined branch.
Complete any deferred cloud/manual gate there. Only then mark the task `done`,
record the accepted revision/evidence and update the hackathon log with its skill.
Rebase or merge the new integration base into dependent worktrees before their
agents continue. A completed branch alone does not unblock dependent tasks.

Keep worktrees with unmerged work or unresolved evidence available. Remove a
task worktree only after its work is integrated and its working tree is clean;
do not use force removal to hide conflicts or delete another agent's changes.

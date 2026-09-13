---
name: opensquad-build
description: Execute or refine an OpenSquad implementation task from the repository plan, including its Convex backend and ASCII-hosted Codex runtime. Use for continuing this app's build or handing a planned task to another developer; not for unrelated Convex apps.
---

# OpenSquad execution

Resolve paths from the repository root containing this skill. This skill and
the `plan/` directory travel with the repository; personal skill installs are
optional helpers, not prerequisites.

1. Read `AGENTS.md` and [the plan](../../../plan/README.md). Run `pnpm plan next`
   (or `node scripts/plan.mjs next` before dependencies are installed).
2. For a named task, run `pnpm plan show PXX`. Read its complete task card in
   [tasks.md](../../../plan/tasks.md), its dependencies in `plan/tasks.json`,
   and only the relevant sections of these references:
   - [Architecture](../../../plan/architecture.md): domain records, app auth,
     schema/indexes, API boundaries, missions, workers, approvals and budgets.
   - [Integrations](../../../plan/integrations.md): ASCII lifecycle, Codex
     login/run protocol, provider setup, secrets destinations and feasibility gates.
   - [Verification](../../../plan/verification.md): observable manual gates
     and the final controlled conversation demo.
   - [Skills](../../../plan/skills.md): available specialist skills and portable
     rules when they are not installed on the executor's machine.
   - [Worktrees](../../../plan/worktrees.md): parallel assignment, shared files,
     isolated development deployments and integration order.
3. Inspect current source, dirty files and package versions. Confirm dependency
   evidence still matches reality and is integrated into your worktree's base.
   The integrator records the task owner, branch/worktree and `in_progress`
   status in the canonical tracker before dispatch. Coordinate reserved files;
   each task agent works in its own checkout and isolated development backend.
4. Build the selected vertical slice. Keep provider-dependent tasks pending or
   blocked with a concrete reason until their probe succeeds. Implement independent
   ready tasks while credentials or human login are unavailable. Do not replace
   the requested ASCII/Codex runtime with API inference without user direction.
5. Preserve these boundaries: Hexclave login is separate from Codex and provider
   auth; Convex checks tenant access; Workflow owns orchestration; worker leases
   only transport external runs; only the backend can send approved email.
6. Run the card's existing checks and manual scenarios. Do not write test files.
   Backend compile/push checks target the selected development deployment; a
   production release is a separate task. Never infer authorization to send mail,
   share credentials, publish, or submit from a planning request.
7. The task agent writes sanitized outcomes and changed paths to
   `plan/evidence/PXX.md` and hands its branch to the integrator. The integrator
   reviews and merges prerequisite changes, completes affected acceptance, then
   updates canonical `plan/tasks.json` to `done` and runs `pnpm plan check`.
   The integrator uses the repository's
   [hackathon skill](../convex-hackathon-skill/SKILL.md) to record implemented
   behavior. Report the accepted gate and all newly ready tasks. Do not stop
   development because an effort estimate or timebox has elapsed.

For plan refinement, edit contracts and affected task dependencies together;
leave implementation tasks pending. Runtime employee instructions are product
data built in P08/P09, distinct from this developer skill. Never copy this skill,
the builder's home configuration, or unrestricted developer tools into customer
sandboxes.

# OpenSquad

Vite and React frontend for the Convex All Gas Hackathon. It uses file-based
TanStack Router routes, TypeScript, pnpm, and Oxlint.

The [executable build plan](plan/README.md) covers the sales CRM, lead research,
outreach and booking, app and Codex authentication, the Convex schema/backend,
ASCII sandboxes, provider integrations, task dependencies and acceptance gates.
Run `pnpm plan next` for the next ready
assignment, or use the repository's `opensquad-build` skill.

## Development

```bash
pnpm install
pnpm dev
```

Useful checks:

```bash
pnpm lint
pnpm build
```

Routes live in `src/routes`. TanStack Router generates `src/routeTree.gen.ts`
during development and builds.

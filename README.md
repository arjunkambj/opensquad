# OpenSquad

Vite and React frontend for the Convex All Gas Hackathon. It uses file-based
TanStack Router routes, TypeScript, pnpm, and Oxlint.

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

# OpenSquad

Vite and React frontend for the Convex All Gas Hackathon. It uses file-based
TanStack Router routes, TypeScript, pnpm, and Oxlint.

The product is an email-only AI outbound agent: website analysis produces an
ICP, sourced leads land in a Contacts table, campaigns write and send email
after a human approval, and replies come back into a unified inbox.

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
during development and builds. The Convex backend lives in `convex/`.

# Hackathon log

- **Project:** OpenSquad
- **Event:** Convex All Gas Hackathon
- **What it does:** A frontend foundation for a sales and outreach CRM, with Hexclave sign-in, a dashboard shell, and date-range overview.
- **Live app:** not deployed
- **Repo:** https://github.com/arjunkambj/opensquad
- **Frontend:** not deployed
- **Convex deployment:** not deployed
- **Components:** none
- **Convex features:** none yet
- **Auth:** Other
- **AI models:** none
- **Started:** 2026-09-13T12:00:25Z
- **Last updated:** 2026-09-13T16:56:05Z

## Log

### 2026-09-13 - 0eb661d
Created the frontend foundation in the project root with React, Vite, pnpm,
Oxlint, and file-based TanStack Router routes for home and about. Verified a
clean lint, production build, and local responses for both routes (`package.json`,
`vite.config.ts`, `src/main.tsx`, `src/routes/`).

### 2026-09-13 - 85c467a
Added the shadcn/ui system with Hugeicons, Inter, and zinc tokens, plus the
sidebar, calendar, and form primitives used by the dashboard (`components.json`,
`src/index.css`, `src/components/ui/`).

### 2026-09-13 - 17c546e
Wired Hexclave React auth into the Vite app and Convex client, including cookie
tokens and Convex JWT providers (`src/hexclave/client.ts`, `src/main.tsx`,
`convex/auth.config.ts`). Auth: Other.

### 2026-09-13 - 7ee8f4e
Ported the MultiFeed remake date picker, collapsible sidebar, user profile menu,
and custom email/Google sign-in page onto OpenSquad. Routes: `/sign-in`,
`/overview`, `/squads`, `/settings`, `/handler/$`. Added a marketing navbar only
(`src/components/Marketing/Navbar.tsx`, `src/routes/_marketing.tsx`). Icons are
Hugeicons; colors use shadcn tokens.

### 2026-09-13 - 1bb4bed
Removed the muted open-state background behind the profile menu avatar trigger
so the button keeps its base radius
(`src/components/Layout/UserProfileMenu.tsx`).

### 2026-09-13 - 988fb16
Refined shared theme variables and UI component styling
(`src/index.css`, `src/components/ui/`, `src/components/auth/SignInForm.tsx`).

### 2026-09-13 - 0d71156
Added the portable sales CRM, research, outreach and booking plan, plus a task
navigator and repository build skill (with `f2a5f14`; `plan/`, `scripts/plan.mjs`,
`AGENTS.md`, `.agents/skills/opensquad-build/`). Replaced development time budgets
with dependency-based parallel worktrees and isolated development backends.

Reviewed unmatched-mail handling, send uncertainty across draft revisions and
company-name search contracts. The navigator rejects premature task starts and
missing dependency declarations. Plan checks, lint and build pass with existing
warnings; CRM, ASCII/Codex and provider integrations remain planned work.
Corrected frontend hosting to not deployed based on the inspected source and
linked the configured repository. Verification: `plan/evidence/P00.md`.

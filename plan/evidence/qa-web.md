# QA — Website (lane 5)

Branch `opensquad/qa-web`, worktree `opensquad-worktrees/qa-web`.
Base: `4ac81cb chore(plan): assign P11 gate, P19, P13, P21/P09, P16, P17 lanes`.
Date: 2026-09-17. Deployment: shared dev (`flexible-grasshopper-949`), frontend only — no functions pushed, no `convex/` touched.

## Environment

- `pnpm install --frozen-lockfile` at root, plus `pnpm install --frozen-lockfile` inside `worker/` (the worker has its own lockfile and is not in the root workspace — see Findings).
- `.env.local` copied from the integration checkout; `VITE_CONVEX_URL`/`VITE_CONVEX_SITE_URL` point at the shared dev deployment.
- `pnpm dev` on `localhost:5173`; all browser checks below ran against it.

## Checks

| Check | Result |
|---|---|
| `pnpm lint` (oxlint) | Pass — 0 warnings, 0 errors, 919 files |
| `pnpm build` | Pass — Vite build + root `tsc` + worker `tsc`. Pre-existing chunk-size advisory only |
| `pnpm exec tsc -b` | Pass — clean typecheck |

## Commits (one per frontend-only defect)

| Commit | Defect |
|---|---|
| `735b063` | `LogoMark` hardcoded one SVG `mask` id; every page rendering more than one logo (navbar + sheet + footer + previews) produced duplicate element ids, and every `url(#…)` resolved to the first mask in the document. Now `useId()`-derived per instance. Verified: 24 masks on `/`, zero duplicate ids. |
| `54fc422` | Lenis `SmoothScroll` hijacked wheel/touch scrolling for `prefers-reduced-motion` users. Now skips instantiation; verified `reducedMotion: 'reduce'` emulation → no `lenis` classes, native scroll intact; normal motion unchanged. |
| `a193a8f` | `/settings?section=` was validated but never consumed — every deep link (`RuntimeBadge`, `ConnectionRequiredPanel`, `MissionDetail`) landed at page top. Sections now carry `id`s and the page scrolls to the named one. Also: `if (!user) return null` blanked the whole page while the user object loaded, and a null `displayName` rendered an empty readOnly input indistinguishable from a skeleton — the workspace sections now render independently and the account card shows the email plus a link to Hexclave account settings. |
| `475fce8` | `SignInGate` always sent signed-in users to `/overview`, discarding `?after_auth_return_to=` that Hexclave appends when it bounces a signed-out request. Now honored for already-signed-in visitors, sanitised to same-origin paths (`//`, scheme, whitespace rejected — verified `//evil.com`, `https://…`, `javascript:` all strip to bare `/sign-in`). |
| `37ddb70` | Onboarding restart-on-reload: no `?step=` always started at "business" even with a saved profile; route comment claimed derivation that did not exist. Now `profile ? "workspace" : "business"` — see Deferred for the workspace-step marker. Also: provisioning screen rendered a bare card with no step rail (spec: rail on every screen); completion copy said "(rolling out soon)" and linked to `/employees` rather than the blocking action — now links `/settings?section=runtime`. |
| `8611ec6` | Spec §6 `j`/`k` queue navigation was absent on `/decisions`. Implemented on the queue container (fires only when focus is inside it — cannot hijack scrolling elsewhere); rows are links so Enter already works. |

## Verified in browser

### `/` (marketing) — 1440 / 768 / 375, light + dark

- 200, title `OpenSquad, an AI sales squad for small agencies`; full meta set (viewport, description, og:title/description/type, twitter card+site), `favicon.svg` loads.
- CLS `0.0000` at all widths; no horizontal overflow anywhere.
- All sections render: hero, squad, how-it-works, features, first-week, pricing, FAQ, CTA, footer.
- Anchor nav works (`#pricing` → target at viewport top, `scroll-pt-24` honored).
- Mobile sheet at 375: opens, all links present (Features/Pricing/FAQ/Sign in), `Escape` closes **and focus returns to the menu trigger**.
- Footer links all resolve internally; X link → `https://x.com/arjunkambj`, `target=_blank`, `rel=noreferrer`.
- All images valid (`pricing-creators.webp` lazy-loads correctly on scroll — an earlier `naturalWidth=0` reading was the lazy-load boundary, not a broken asset).
- No console errors, no uncaught exceptions, no failed requests other than `r.hexclave.com` session-replay batch (third-party telemetry; see Findings).
- Text-contrast audit (computed styles, 4.5:1 at normal size): **no violations in app markup** — the only sub-threshold nodes are inside the TanStack devtools overlay (`items`, `Matches`, `History`), dev-only third-party chrome.
- Dark mode (verified via `localStorage.theme=dark`; the app deliberately does not follow `prefers-color-scheme` per ux.md): dark tokens apply, no overflow, no errors, marketing ink sections read correctly. The in-app toggle lives in the profile menu — signed-in only.
- Keyboard: Tab order is linear through navbar links → CTA → sheet trigger; visible focus ring on all controls.
- Screenshots: `plan/evidence/qa-web/marketing-{1440,768,375}.png`, `marketing-{1440,375}-dark.png`, `marketing-sheet-375.png`, `focus-cta.png`.

### `/sign-in` — 1440 / 768 / 375, light + dark

- 200; h1 "Welcome to OpenSquad"; split layout at 1440 (marketing panel left), single column ≤768 with form fully usable at 375.
- Google button present; `Email code`/`Password` tabs switch; password tab reveals password field + "Forgot password" → `/handler/forgot-password`; invalid submit shows an error toast (no uncaught errors).
- CLS `0.0000`/`0.0011`/`0.0381` (375) — the 375 residual is font-swap; under the 0.1 "good" line.
- No horizontal overflow; no console errors.
- Open-redirect probes rejected (see commit `475fce8`).
- **Not exercised end-to-end:** Google OAuth and email-code completion — needs a real account (see Blockers).
- Screenshots: `sign-in-{1440,768,375}.png`, `sign-in-{1440,375}-dark.png`, `sign-in-375-{code,password}.png`, `sign-in-375-recheck.png`.

### Signed-in routes — gate behavior verified, content blocked

Every dashboard route tested while signed out correctly redirects to `/sign-in?after_auth_return_to=<route>` with the shell intact — including a bogus `/nope` path, which means the catch-all + auth gate compose correctly (screenshots `authed-*.png` all show the sign-in page after redirect). Actual content requires a session (see Blockers).

## Verified by code review (signed-in routes)

- **`/overview` board**: four columns × `listBoard` with `visibility: "archived"` arg; per-column paging is local (correctly not in URL); empty states distinguish filtered-to-zero vs true empty vs paged-out; mobile `?column=` selector keeps all four counts visible; `boundedCount` honesty (`25+`, never fabricated).
- **Mission detail**: route param + parent-inherited search; `Escape` → board navigation with typing-target and open-dialog guards; focus memory returns focus to the exact card on the exact board view, dropped on filter/column/page change.
- **`/decisions`**: mission-scoped `?mission=` filter + cursor; rows are links (paste-able, Enter-able); grouping in arrival order; j/k now implemented (`8611ec6`).
- **`/settings`**: all six sections render with owner/operator/viewer gating and `PermissionNote`s; deep links now scroll (`a193a8f`).
- **`/squads`**: `Redirect` → `/employees`.
- **Sidebar**: segment-boundary active matching, `⌘K` palette (typing-guarded), `⌘B` (typing-guarded), decisions badge reuses the same query args as the attention block.
- **Onboarding**: `?step=` validated, `replace` navigation, step rail reachable only backwards, profile-derived resume (`37ddb70`), runtime connect as the finish line.
- **`_dashboard` shell**: error boundary maps `NOT_FOUND`/error to in-shell `EmptyState`/`ErrorState`; `_workspace` gate redirects membership-less users to onboarding.

## Findings — reported, not fixed

1. **`og:image`, `og:url`, canonical absent** on `/` and `/sign-in`. Needs the canonical production origin — a product/hosting decision, not guessable.
2. **`r.hexclave.com` session-replay `POST …/batch` aborts** (`net::ERR_ABORTED`) during page load. Third-party Hexclave telemetry; the app itself loads clean. Worth confirming whether the project's session-replay is enabled/intended.
3. **Worker package not in the root pnpm workspace** — a fresh `pnpm install` + `pnpm build` fails at the worker `tsc` until `pnpm install` is also run inside `worker/`. Either document it or add worker install to setup docs. (Build passes fully once installed.)
4. **Onboarding resume can't detect a completed workspace step** — accepting defaults writes nothing, so no field distinguishes "visited+saved" from "skipped". Derivation lands on `workspace` after a saved profile, which is honest; a precise marker would need a backend field (out of lane scope).
5. **`/decisions` kind filter and resolved-history toggle intentionally absent** — `listOpen` has no kind arg and no resolved query exists; code comments name the needed backend contract (ux.md §2 contract addition (b)). Backend lane item.
6. **Two attention-block slots** ("Unassigned mail", "Overdue next actions") render "Not available yet" by design — `conversations`/`prospects` queries don't exist yet. Backend lane items, correctly disclosed in-UI.

## Blockers

- **A signed-in test account is required to finish this lane.** Needed to run: onboarding form submission, `/employees`, `/overview` board + mission detail against real records, `/decisions` against real rows, `/settings` forms, the `/squads`→`/employees` redirect as a signed-in user, ⌘K/⌘B live, V01 steps 3–5, all of V02 (two owners), and V08–V11 against real mission/decision data. Per instructions I did not create one — please provide either a Hexclave test user on `flexible-grasshopper-949` or a session for it.
- Because of that, sign-in OAuth/code completion, all authenticated routes, and every data-bearing verification row remain **unverified, not failed**.

## Deferred

- Sign-in CLS 0.038 at 375 (font swap) — under threshold; revisit only if it regresses.
- V08–V11, V01-auth, V02, P12 in-app keyboard flows — all require the signed-in session above; the code paths each rely on were reviewed.
- `prefers-color-scheme` theme detection — deliberately deferred per ux.md; the in-app toggle is the supported path.

## Shared files the integrator must merge

- `src/routes/sign-in.tsx` — new `validateSearch` (`after_auth_return_to`); other lanes touching this route should take this version.
- `src/routes/_dashboard/settings.tsx` + `src/components/settings/SettingsSections.tsx` — `settingsSectionId` export is now the anchor contract; any new section needs an id + entry in `SETTINGS_SECTIONS`.
- `src/components/onboarding/OnboardingWizard.tsx` — `StepRail` extracted; completion links `/settings?section=runtime`.
- `src/components/decisions/DecisionQueue.tsx` — `data-decision-row` attribute + `onQueueKeyDown` (P13's component — merge carefully).
- `src/components/Layout/Logo.tsx`, `src/components/Marketing/SmoothScroll.tsx`.
- `plan/tasks.json` and `hackathon.md` untouched — integrator's.

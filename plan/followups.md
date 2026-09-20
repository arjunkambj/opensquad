# Follow-ups for the final review + fix pass

The owner asked for speed: each task is implement → four verify commands →
merge, with **one** review-and-fix pass at the end (T50). This file is the
running list that pass starts from. Items come from task hand-offs
("unverified", deferred decisions) and from integrator checks. Tick when fixed.

## Decisions waiting on the owner
- [ ] Restore rehearsal on dev (T06): no pre-clear export exists. Accept the
      substitute (export current dev → `import --replace` → app runs) or skip.
- [ ] Keep email+password sign-in (the only source of unverified emails), or
      restrict to one-time code + Google. The verified-email guard ships either way.
- [ ] Open tracking: provider supports it only with a custom tracking domain,
      and the installed mail component rejects `message.opened`. Default taken:
      ship without the Opened metric; webhooks subscribe to the 7 safe event types.
- [ ] `/tour` currently redirects to `/` (its old content was prepared sample
      cards). Rebuild as real marketing copy, or drop it from PLAN §5.

## Live checks still owed (need a signed-in owner, a real key, or a call this session may not make)
- [ ] T00.3: people search pages 1–3 cost 0 on this account (balance before/after) + live preview-row shape.
- [ ] T00.4 / T10: AgentMail live shapes and the whole connect flow with a real key.
- [ ] T00.5: one real identity dump showing `emailVerified` reaches Convex.
- [ ] T06: a suppressed address is refused by a real send preflight (fresh workspace); owner signs in and lands in onboarding.
- [ ] T04: shell click-through against refs 20 and 24 (needs an agent with `onboardingStep: "done"` — first writer is T23); sidebar collapse persistence; bell and credits block against real rows; dark mode.
- [ ] T13: visual sign-off of every kit component when T20–T23 mount them; keyboard pass; dark mode.

## Code follow-ups
- [ ] Owner rule (colours only from `src/index.css` tokens): pre-pivot offenders are `src/components/marketing/CompanyMark.tsx` (hex backgrounds AND made-up company names — also a no-mock violation), `marketing/Pricing.tsx` and `auth/SignInForm.tsx` (rgba shadow literals). Everything built since the pivot audits clean. Fix with the T50 landing rewrite.
- [ ] Owner rule (no custom team step): the pre-pivot wizard's "Workspace & policy" step goes with T20; consider storing the auth provider's team id on the workspace and defaulting the workspace name from it.
- [ ] Landing hero still has pre-pivot copy ("AI Sales Squad", "Give it a campaign, Scout finds…") and a Pricing nav link with no page (T50 landing copy).
- [ ] `convex/**` comments still say "OpenSquad" in `inbox/receiptDrain.ts`, `integrations/firecrawl.ts`, `integrations/agentmail.ts`, `lib/auth.ts`, `outreach/sendOutcome.ts` (not user-visible; the T50 grep will hit them).
- [ ] Unused after T04: `src/components/ui/command.tsx`, `ui/kbd.tsx`, deps `cmdk` and `@fontsource-variable/inter`.
- [ ] Two `EmptyState` components: `src/components/states/states.tsx` (pre-pivot) and `src/components/kit/EmptyState.tsx`. Fold into one.
- [ ] `src/components/shared/` was not folded into `kit/` (PLAN §10 has no `shared/`).
- [ ] Backend files above the ~300-line guideline after T05: `outreach/sendOutcome.ts` 401, `inbox/quarantine.ts` 366, `outreach/sendReconcile.ts` 334, `inbox/conversationResume.ts` 331, `lib/validators/shared.ts` 571, `lib/validators/leads.ts` 526; plus `integrations/agentmail.ts` 934 and `integrations/firecrawl.ts` 1016 (rewritten by T10 / T12).
- [ ] The three component-defined shape migrations have no `returns` validator (the migrations component registers them) — the one exception to EXECUTION §0.6.
- [ ] `prospects.searchIndex("search_company_name")` indexes an optional field — accepted by the dev push; confirm search behaves once T30 produces rows.
- [ ] `ChipInput` uses an × remove glyph where ref 06 draws a tick; decide at the wave-2 visual check.
- [ ] Rows remain on dev in tables no longer in the schema (`missions`, `runs`, `decisions`, …): delete from the dashboard.

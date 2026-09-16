# Feedback intake — session log template

Copy this file per session to `plan/feedback/session-YYYYMMDD-PN.md` (N = the
participant number). Keep it sanitized: **no names, no agency, no real email
addresses, no prospect identities, no message bodies.** If the participant
consents to a quote, quote the *words*, never the attribution.

## Session header

| Field | Value |
|---|---|
| Date / duration | |
| Participant | P1 — role + agency size only (e.g. "founder, ~4-person web studio") |
| Deployment + app commit | |
| Moderator | |
| Consent — notes | yes / no |
| Consent — screen recording | yes / no |
| Consent — anonymized quote in submission | yes / no |
| Blocks completed (of 6) | e.g. 1–5, booking skipped (not shipped) |

## Observations

One row per observation. **Severity:** blocker (stops the loop) / major
(slows or misleads) / minor (polish) / delight (worth keeping + maybe
marketing). **Owning card** is the plan task that should absorb the fix; use
`NEW` when nothing owns it and write the proposed card block at the bottom.

| # | Run-sheet block | What happened (observed, not interpreted) | Participant's words (if consented) | Severity | Proposed feature or fix | Owning task card | Status |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | | open |

### Example row (delete before use)

| # | Run-sheet block | What happened | Participant's words | Severity | Proposed feature or fix | Owning task card | Status |
|---|---|---|---|---|---|---|---|
| ex | 6:00–9:00 CRM | Hovered the stage dropdown ~15s looking for "replied"; it wasn't there; asked "where do I say they answered?" | "I want a column for people who wrote back" | major | Expose `replied`-visible stage filter presets on `/leads`; check whether classification already maps to a stage the list doesn't surface | P13 (CRM UI) / P19 (stage model) | open |

## Wrap answers (three questions)

1. Wouldn't use it because…
2. Wouldn't give up…
3. Would tell a peer…

## Follow-ups the participant agreed to

- e.g. "OK to email a screenshot for the log" — with what exactly.

## Proposed task-card blocks for the integrator

After the session, convert every `NEW` row above into a card block here, in
this exact shape so the integrator can paste it into `plan/tasks.md` /
`tasks.json` consideration:

```
### PXX — <short title>
Dependencies: <existing cards or none>. Owner: <frontend/backend/design>.
Problem observed: <one line from the observation, sanitized>.
Deliverable: <the smallest change that resolves it>.
Files: <paths if known>.
Gate: <how a reviewer confirms it>.
```

Frontend-only fixes that are already covered by an existing open card do
**not** need a new block — implement them in their own commits on this lane
or hand them to the owning lane per the runbook.

## Session verdict (moderator, ≤3 lines)

Did the supervised loop hold together end to end? What is the single most
urgent correction before the video is recorded?

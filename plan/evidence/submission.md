# Submission packet draft — Convex All Gas Hackathon

Drafted 2026-09-16 by the P17 lane from the official event page
(<https://www.convex.dev/hackathons/all-gas>). **Prepared, not submitted.**
The vibeapps.dev form is JS-rendered; its exact field labels could not be
read without a browser, so fields below follow the requirements the event
page states. Re-read the form itself at submit time (P18 owns submission).

## Official requirements, re-checked against the page today

- **Deadline: 22 September, 12:00 PM Pacific** — confirmed on the page.
  For 2026 that is **19:00 UTC / 23 September 00:30 IST**. Allow upload
  time before the cutoff.
- Submit at: <https://vibeapps.dev/judging/convex-all-gas-hackathon-openai/submit>
- Must include: **public GitHub repo**, a **live `convex.site` or
  `chatgpt.site` URL judges can open without an invite**, a **video under
  three minutes**, and a **social post on X or LinkedIn tagging @convex,
  @OpenAI, @firecrawl and @agentmail**.
- "Your hackathon build log is what judges read" — root `hackathon.md`
  carries what was built, the stack, the live URL and the demo link.
- Sponsors must do real work: Convex (backend), Firecrawl (data),
  AgentMail (inbox), OpenAI/Codex (agent runtime).
- Only apps started on or after 25 Aug qualify — OpenSquad started
  2026-09-13 per `hackathon.md`.

## Draft field values

| Field | Value |
|---|---|
| Project name | OpenSquad |
| Tagline | A supervised AI sales squad for small agencies — it finds, researches and drafts, but a human approves every word that sends. |
| Repository URL | `https://github.com/arjunkambj/opensquad` — **verify public visibility in a private window before submitting** |
| Live app URL | `{{pending P16}}` — the `.convex.site` static-hosting URL, must resolve signed-out |
| Video URL | `{{pending P17 recording}}` — under 3:00, per `plan/feedback/video-shot-list.md` |
| Social post URL | `{{pending authorized publish}}` — draft at `plan/feedback/social-post.md` |
| Build log | root `hackathon.md` in the repo |

## Description draft (for the long-text field)

> OpenSquad is a supervised AI sales team for small web/design agencies.
> You confirm a campaign; Scout discovers up to five fitting companies;
> Researcher reads their sites and produces source-backed opportunity
> briefs where every claim links the page it came from; Outreach writes
> the exact email. **Nothing sends without a human approving the exact
> recipient, subject, body and revision.** Approved mail goes out through
> one audited attempt per draft; replies land in a shared inbox, classify
> with an overridable label, and update the built-in CRM — owners, sales
> stages, evidence, next actions — all the way to a human-confirmed
> meeting, where "proposed" is never "confirmed".
>
> Stack: Convex is the whole backend — schema, indexes, queries,
> mutations, HTTP actions, crons, scheduled functions, and
> `@convex-dev/workflow` for durable orchestration that survives pauses and
> restarts. `@firecrawl/firecrawl-convex` feeds bounded research retrieval;
> `@agentmail/convex` owns the workspace inbox and signed webhooks; each
> workspace's agents run in their own ASCII Box on Codex (OpenAI), reached
> through a scoped worker bridge. Auth is Hexclave; the frontend is
> Vite/React/TanStack Router hosted on Convex static hosting.
>
> Honest limits are documented in `hackathon.md`: five leads per campaign,
> one inbox per workspace, meetings recorded by a human (no calendar
> sync), and Apollo discovery deferred behind an owner-held OAuth grant.

## Pre-submit checks (P18's gate, listed here so nothing is forgotten)

- [ ] Re-fetch the event page the day of submission; confirm the deadline
      and form URL have not moved.
- [ ] `hackathon.md` refreshed from real evidence only — no PII, no
      speculative claims (P18 owns the refresh).
- [ ] Repo public; `plan/` and `hackathon.md` committed; no secrets in
      tracked files.
- [ ] Live URL opens in a fresh private browser and the judge path works
      (V20).
- [ ] Video under 3:00, uploaded, plays signed-out.
- [ ] Social post live and linking the app (V22).
- [ ] Submission receipt (URL + timestamp) recorded in `plan/evidence/P18.md`.

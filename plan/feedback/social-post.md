# Social post draft — review before publishing

**Status: draft, not published.** Publish only on the owner's authorization,
with the live URL and video link filled in and every claim below re-checked
against the released build on the day it posts (the log's honest-limits
section is the checklist). Both versions tag all four sponsors per the event
rules; keep whichever platform is authorized.

## X version (≤280 chars)

> Built OpenSquad for the @convex All Gas hackathon: a supervised AI sales
> squad for small agencies. Scout finds leads, Researcher cites every claim
> (@firecrawl), a human approves the exact email, @agentmail sends it,
> replies book meetings. Every agent run lives in its own ASCII Box w/ Codex
> (@OpenAI). Demo: {{video_url}} App: {{app_url}}

*(Count check required after URLs land; drop "App:" clause if over.)*

## LinkedIn version

> **OpenSquad — a supervised AI sales squad, built for the Convex All Gas
> hackathon.**
>
> Small web/design agencies live on outbound, but nobody wants an AI
> freelancing their name into strangers' inboxes. So OpenSquad runs the
> loop and keeps the human on the send button:
>
> - Scout discovers up to five fitting companies per campaign
> - Researcher reads their sites and cites every claim to a real source URL
>   (powered by @firecrawl)
> - Outreach writes the exact email — and nothing sends until you approve
>   the bytes, the revision, and the recipient
> - Sends go out through @agentmail; replies land in one shared inbox,
>   classify themselves, and update the built-in CRM
> - Meetings are recorded by a human — proposed is never "confirmed"
>
> The whole thing runs on @convex: workflows, decisions, crons and the CRM.
> Each workspace's agents run inside their own ASCII Box on Codex
> (@OpenAI), with Convex Workflow keeping durable state across pauses and
> approvals.
>
> App: {{app_url}} · 3-min demo: {{video_url}} · Source:
> {{repo_url}}
>
> Rough edges included — it's three weeks old. Feedback very welcome.

## Claims checklist (verify each before posting)

- [ ] "cites every claim to a real source URL" — true on the release build
      (P21 evidence rows are admission-gated to retrieved pages).
- [ ] "nothing sends until you approve" — true: exact-revision approval +
      preflight re-run at dispatch (P10).
- [ ] "replies land / classify / update the CRM" — verified live on the
      deployment the post links to (P11/P19/P13 acceptance state).
- [ ] "ASCII Box on Codex" — only claim the shipped wiring, not the G1
      spike; if the deployed pipeline never ran a live turn, change to
      "each workspace's agents run in an isolated ASCII Box (Codex-ready)".
- [ ] Live URL resolves signed-out; video link plays; repo is public.

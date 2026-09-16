# 20-minute moderated trial script — one agency user

One participant, one moderator (screen-shared video call). The participant
drives a **prepared demo workspace** on the deployment under test; the
moderator watches, takes notes in `intake-template.md`, and does not touch
the keyboard. Total: 20 minutes including consent and wrap.

> **Honesty rule for this script:** if a surface below has not shipped on the
> deployment being demoed, the moderator says "that part isn't built yet" and
> moves on — the gap is itself a recorded observation. Nothing is simulated
> or narrated as if it worked.

## Pre-flight checklist (run the day before; all must pass)

- [ ] Public or shared deployment URL opens for a signed-out visitor and
      sign-in works (P16 acceptance / Hexclave).
- [ ] Demo workspace exists with: confirmed campaign (5-lead cap), business
      profile, timezone + send window, runtime connected and `live` — check
      `/settings?section=runtime` badge.
- [ ] One mission has already produced ≥2 researched leads so the session
      does not wait on discovery latency (prepared data is labeled prepared
      in the workspace; see V20 labeling rule).
- [ ] One exact outreach draft sits open in `/decisions` awaiting approval.
- [ ] Controlled recipient inbox is reachable and the workspace AgentMail
      inbox can send to it (P10/P11 path verified that day).
- [ ] A second moderator browser session is signed in as an operator to show
      two-session behavior if the participant asks.
- [ ] The intake template is duplicated for this session; consent fields
      blank until read aloud.
- [ ] Fallback plan read once: `video-shot-list.md` §Fallback applies equally
      to live latency here.

## Run sheet

### 0:00–2:00 — Consent and framing

Moderator reads aloud, verbatim:

> "Thanks for doing this. Quick ground rules: this is a working hackathon
> build, so expect rough edges — finding them is the point. Nothing you do
> today emails a real prospect; replies come from a controlled inbox I
> control. With your OK I'll take notes and record my screen — I won't
> record you or publish anything identifiable without asking. You can skip
> anything or stop anytime. Still good?"

Log consent (notes? screen recording? quotable?) in the intake template.
Then one framing line, not a demo: *"You're a small web agency. This is a
supervised AI sales squad — it finds and researches leads, but you approve
every word that leaves. Drive it like it's yours."*

### 2:00–6:00 — Lead search and research (journey J1 tail + V12)

- Participant opens the prepared campaign mission from `/overview` and finds
  where the discovered companies landed.
- Open one lead's research: *"What do you make of what it found? Would you
  trust it enough to email them?"*
- Watch for: do they notice source links and retrieval times? Do they look
  for *why* a company was kept or rejected? Do they ask for more/fewer than
  five leads?
- **Do not** explain the employees first — let them discover Scout/
  Researcher/Outreach attribution on the evidence.

### 6:00–9:00 — CRM ownership and status (journey J2/J5 setup, V23)

- Send the participant to `/leads`. *"Pretend two of you work these leads.
  Make one yours, and move it to whatever stage fits what just happened."*
- Watch for: can they find assign/stage/next-action without guidance? Do
  they reach for a stage the product doesn't have (e.g. "replied–negative")?
  Do they expect drag-and-drop? Do they look for a due-date reminder?
- Set one dated next action; ask them to find where overdue work surfaces.

### 9:00–13:00 — Reviewed outreach (journey J3, V13)

- *"Outreach drafted the first email. Find it, read it like it has your name
  on it, and do what you'd really do — approve, edit, or send it back."*
- Watch for: do they read the exact recipient/subject/body? Do they notice
  the revision/hash? Do they edit — and do they understand that editing
  withdraws the approval? Do they expect one-click approve from the list?
- If they approve: the send goes to the **controlled inbox only**. If they
  request changes: that's the session's data point, equally valuable.

### 13:00–16:00 — Inbox reply (journey J4, V15/V16)

- Moderator triggers the prepared controlled reply (interested, ambiguous on
  time — e.g. "Looks interesting, could do Tuesday"). *"A reply just came
  in. Find it and figure out where things stand."*
- Watch for: do they find `/inbox` vs. the lead's conversation tab? Do they
  trust the classification label? Do they look for a draft response, and do
  they understand it still needs their approval? Do they reach for takeover?

### 16:00–19:00 — Proposed/confirmed booking (journey J5, V24)

- *"They're interested. Get a meeting on the books."*
- Watch for: do they propose slots or the booking link? Do they understand
  **proposed ≠ confirmed** — that "Tuesday works" does not book anything
  until a human records the agreed time? Do they find where the confirmed
  meeting lands on the lead and in next actions?
- If a booking surface isn't on this deployment yet, the moderator says so
  and asks what they'd expect; recorded as feedback, not a pass.

### 19:00–20:00 — Wrap (three questions, then silence)

1. "What's the one thing that would stop you using this on Monday?"
2. "What did it do that you wouldn't want to give up?"
3. "Who else should I show this to, and what would you tell them?"

Stop writing while they answer #3 — verbatim beats paraphrase. Confirm what
may be quoted before hanging up.

## Observer rules

- Non-leading prompts only: "what would you do next?", never "click Approve".
- Log time-stuck moments, not just errors — hesitation past ~10s is data.
- Every observation goes into the intake template the same day, tagged to
  the run-sheet block it came from, mapped to a proposed feature/fix and
  its owning task card.
- The participant's identity, agency and prospects never enter the repo;
  the log says "P1 — founder, small web studio" at most.

## Contingencies

- **Provider latency on send/reply:** say what is happening ("the provider
  is slow; the attempt is recorded and retrying honestly"), keep the session
  moving on another lead, and come back. Do not refresh-spam — the attempt
  states are the product.
- **Something crashes:** that's the finding. Screenshot the error, log it,
  move to the next block.
- **They finish early:** offer the unscripted exploration prompt — "poke at
  whatever you'd check before paying for this."

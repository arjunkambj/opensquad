# V21 shot list — 2:50 demo recording (10s margin inside 3:00)

Target runtime **2:50**, hard cap 3:00. One continuous screen recording of
the released deployment plus voiceover. Prepared data is labeled prepared
on screen; the controlled recipient is the only mailbox touched. Record at
a viewport where UI text stays readable at 1080p export (≥1440px window,
150% browser zoom if needed).

## Pre-record checklist

- [ ] Deployment is the release build the judges will open; commit hash
      recorded in `plan/evidence/P17.md`.
- [ ] Demo workspace holds: confirmed campaign (5-lead cap, agency offer in
      the profile), ≥3 leads across different stages, one source-backed
      research brief, one open `draft_approval` decision, one controlled
      conversation, runtime badge live.
- [ ] Controlled inbox open in a second browser profile, ready to receive
      and reply.
- [ ] Notifications, bookmarks bar, other tabs and anything personal are
      hidden; only the demo workspace is visible. No tokens, login codes or
      real inboxes on screen at any point.
- [ ] Fallback clip already exported (see below) and on the desktop.

## Shots

| # | Timecode | Screen / route | Action on screen | Voiceover (say, roughly) |
|---|---|---|---|---|
| 1 | 0:00–0:20 | `/leads` | Land on the CRM home; hover the offer line, the stage strip and the campaign filter showing the five-lead cap. Scroll the rows once. | "OpenSquad is a supervised AI sales squad for a small agency. Every lead it works lives here — owner, stage, evidence, next action." |
| 2 | 0:20–0:50 | `/overview/missions/$missionId` → lead evidence | Open the **labeled** prepared research run; click one prospect's observation through to its source URL and retrieval time. | "Scout picked the companies; Researcher read their sites. Every claim cites the page it came from — labeled prepared run, real evidence rows." |
| 3 | 0:50–1:20 | `/decisions/$decisionId` | Show the exact draft: recipient, subject, body, revision, hash; name Scout/Researcher/Outreach contributions; click **Approve**. | "Nothing sends itself. This is the exact email — revision and fingerprint — and approving it is the only way it leaves." |
| 4 | 1:20–1:55 | decision → controlled inbox | Send state walks `reserved → requesting → acknowledged`; cut to the controlled inbox receiving it; reply "interested, Tuesday?" from the controlled side. | "The send goes through one audited attempt — watch the states. This inbox is our controlled recipient… and here's a real reply." |
| 5 | 1:55–2:30 | `/inbox/$conversationId` + `/leads` | Reply lands and classifies; the lead's stage/next action update live in a second pane; open the prepared response draft proposing two slots (or the booking link) and approve it. | "The reply matched the right lead, the CRM moved, and the follow-up draft still needs the same approval — proposing Tuesday." |
| 6 | 2:30–2:50 | `/leads/$prospectId?tab=booking` | Record the **human** confirmation: Tuesday, start/end, timezone, basis + evidence link; show it flip Proposed → Confirmed, show the lead's new next action and the receipt trail. Hard cut at 2:50. | "A human confirms the meeting — time, timezone, what evidence. Proposed is not confirmed. That's the loop: found, researched, approved, replied, booked." |

**Margin:** 10 seconds of air remain. If any shot overruns, cut from shot 2
(scroll fewer evidence rows), never from shot 3 or 6 — the approval and the
human-confirmed booking are the thesis.

## Fallback clip — provider latency (record first, label on use)

If the send/reply legs (shots 4–5) stall live, splice in the fallback clip
at the cut point with a persistent lower-third:

> **"Recorded earlier — provider latency during take. Same workspace, same
> controlled inbox."**

Fallback content (one clip, ~35s): acknowledged send receipt → controlled
inbox reply → classification + live CRM update. Record it the same day on
the same deployment and workspace; label stays on screen for the entire
clip. Using it satisfies V21's "honestly labeled recorded continuation";
using an **unlabeled** clip does not.

## Export requirements (V21 pass conditions)

- Strictly under 3:00; UI text readable; narration names what Convex,
  the ASCII/Codex runtime and each provider actually did — no "magic".
- No private tokens, login codes, full real email addresses or unrelated
  inbox contents anywhere in frame.
- Prepared run and controlled confirmation are labeled on screen, not just
  in narration.
- Large media stays out of git; the link lands in `plan/evidence/P17.md`
  and `plan/evidence/submission.md`.

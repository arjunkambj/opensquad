# OpenSquad manual verification and demo runbook

Status: acceptance criteria, not evidence that these behaviors already work.

The primary runtime is a workspace-isolated ASCII Box running Codex App Server. Convex owns application state, authorization, Workflow orchestration, durable decisions and scheduling. Provider calls and worker results do not grant permission to send email. These requirements are self-contained so an executor does not need private or ignored planning documents.

## How to execute and record results

- Do not create test files or automated test suites: the user explicitly prohibited tests unless requested. Run existing `pnpm lint` and `pnpm build`, then exercise these manual scenarios against the implemented app.
- Use development or staging, two independent browser sessions, two different workspace owners, and controlled sender/recipient inboxes. Never send to discovered real prospects for verification.
- Before each scenario, record app commit, deployment, workspace alias, relevant mission/run/decision IDs, date and expected result. Afterward record **pass**, **fail**, or **blocked**, the actual result, and an evidence link. Missing credentials or unimplemented controls mean blocked, not passed.
- Keep verification notes in the root `hackathon.md` or a linked tracked evidence log. Capture screenshots, sanitized event receipts and relevant errors; do not publish secrets, login codes, session tokens, full real email addresses or private message bodies.
- Use the implementation's documented staging-only replay/fault procedure where specified. If it does not exist, record that scenario as blocked. Never disable production authentication or signature checks to make a scenario pass.
- Retest failed scenarios after their fixes and related affected scenarios. Do not repeat passed checks without a relevant change.

## Foundation, authorization and setup

### V01 — Fresh-checkout startup and existing checks

1. Follow the tracked setup instructions from a fresh checkout, install dependencies with the pinned package manager, configure documented environment variable names, and start the frontend and Convex development backend.
2. Run `pnpm lint` and `pnpm build`. Start the ASCII worker using the documented setup and lifecycle instructions.
3. Open sign-in, complete account setup, and reload the application.

Pass: setup requires no undocumented machine-local state; existing checks pass; the app opens the correct workspace. Required missing configuration produces an actionable message. Record exact commands and outcomes without environment values.

### V02 — Human authentication and actual workspace isolation

1. Create owner A/workspace A and owner B/workspace B in separate sessions. Create a mission, prospect, evidence item and draft in A.
2. As B, open A's known mission, prospect, decision and conversation URLs. Using documented application calls, also request or mutate A's record IDs directly; do not limit this check to hidden navigation.
3. Repeat a representative read and mutation while signed out. Try a role-restricted action from a permitted non-owner role if that role ships.

Pass: server functions reject unauthorized access and reveal no A data. A caller-supplied workspace ID does not override authenticated membership. Owner-only connection, limit and membership actions follow the declared role matrix.

### V03 — Campaign setup and honest source/contact handling

1. Save business website, offer, ideal customer, source/filter criteria, timezone, prospect limit and enrichment allowance; reload them.
2. Review interpreted scope before dispatch. Try an invalid URL, an unsupported source, missing access and a requested prospect count above the configured cap.
3. Inspect a campaign containing a duplicate domain, an unknown contact and an unavailable source field.

Pass: the backend enforces the selected cap and supported route; connection blockers explain a concrete remedy. Canonical domains deduplicate companies while preserving source references. Unknown values stay unknown, anonymous businesses are skipped, and guessed email addresses are never described as verified.

## ASCII runtime and Convex workflow

### V04 — Workspace Codex connection and provider availability

1. From workspace settings, provision or resume its ASCII Box and initiate the supported Codex App Server connection flow.
2. Complete login as the authorized owner. Verify provider connections inside that same Box, including one actual discovery/research call and contact enrichment when required by the chosen source route.
3. Open workspace B and inspect its runtime state. Disconnect or expire a staging connection and dispatch a mission requiring it.

Pass: workspaces have separate runtime credentials and files; A's login does not authenticate B. The frontend receives safe connection status only. Missing access blocks work with a recovery action; builder-desktop integration availability is not counted as a successful runtime check.

### V05 — Durable handoff, worker restart and duplicate callback

1. Start one small mission and capture its Workflow and worker-operation references. Stop the worker during a bounded research operation using the documented staging lifecycle control.
2. Resume the Box and worker. Observe operation recovery and the eventual saved result.
3. Replay the same successful worker result through the staging replay procedure.

Pass: Convex retains authoritative mission and step state; restart does not assume a stopped process survived. A bounded callback or durable event resumes Workflow without a daemon-length Convex action. Duplicate results do not duplicate prospects, briefs or activity. Recovery follows the documented operation/lease policy.

### V06 — Credential scope, lease expiry and stale completion

1. Submit a callback with an invalid worker credential, then try an A worker credential against a B record.
2. Let a staging operation's lease expire and recover it as a new generation. Deliver the old generation's completion after the new generation has progressed.
3. Attempt an operation outside the worker's allowed capability set, including direct email sending through a research integration.

Pass: invalid/cross-workspace/out-of-scope requests are rejected. Old results cannot overwrite a newer attempt. The worker has no Convex deployment administrator key; enforced tool policy leaves final outbound sending under the application approval service.

### V07 — Concurrency, usage limits and bounded work

1. Start two missions in one workspace; inspect queue and employee status. Use a staging allowance small enough for one permitted operation, then request another.
2. Exercise a provider rate limit, unavailable model account and a research call exceeding its configured input/tool/runtime bound.
3. Inspect estimated/reserved versus reported actual usage and release of reservations after failure.

Pass: configured workspace concurrency and budgets are enforced server-side; queued work is distinguishable from executing work. Exhaustion does not silently switch accounts or expand scope. Retry timing and recovery are visible. Missing usage is shown as unavailable; token estimates are not claimed as exact currency spend.

## Mission Control and product behavior

### V08 — Board truth, counts and independent sales state

1. Create queued, active, waiting-for-user, completed, failed, paused and cancelled missions through their actual supported actions.
2. Inspect Backlog, Needs you, In flight and Done using the plan's declared mapping for all states. Compare decision/completion counters with the underlying records and campaign filter.
3. Inspect a finished research mission whose prospect still needs contact, and a sent email whose prospect has not converted.

Pass: machine failure has explicit recovery treatment and does not pose as a required approval. Completion requires promised output. Card owner, priority, progress, prospect/decision counts and last update are accurate. Activity animations require a real current execution signal; sales stage stays independent of mission state.

### V09 — Deep links, filters, archive and reload

1. Filter Mission Control by campaign; open a card, copy its URL, reload and open it in the other authorized session.
2. Follow its prospect, evidence, decision and receipt links; close detail and use browser Back/Forward.
3. Archive and restore a completed mission. Exercise supported trash/restore behavior separately. Open a missing or unauthorized record URL.

Pass: links restore the intended record and board context; closing detail preserves filters. Historical activity dates cannot hide an unfinished current mission. Archive/trash changes visibility without claiming execution success. Missing or inaccessible records show a useful safe state.

### V10 — Mobile, keyboard and accessible state changes

1. At a narrow phone viewport, navigate every board column and open a long mission, research brief, exact draft and inbox thread.
2. Repeat creation, detail navigation and draft review using keyboard only. Close dialogs/sheets and check focus return.
3. Check labels, focus visibility, status text, screen-reader announcements where implemented, and the existing light/dark themes.

Pass: essential content/actions remain reachable without clipped text; mobile detail uses the available screen. Modal focus is contained and restored. State meaning does not depend only on color or animation; destructive or external-action controls identify what they do.

### V11 — Empty, loading, offline, stale and error states

1. Visit a new workspace with no campaigns, prospects, inbox conversations or activity, and a filter with zero results.
2. Slow/disconnect the browser network during load and reconnect during an active mission. Disconnect the worker separately.
3. Exercise provider failure and partial research success; inspect user-facing errors and retry actions.

Pass: empty states offer relevant next actions, loading does not look like completed empty work, and reconnect restores authoritative state. Stale/disconnected execution is explicit. Errors preserve useful context without exposing secrets; retry is offered only when safe. Partial output names successful, rejected and unavailable results.

### V12 — Evidence, employee handoffs and receipts

1. Execute a campaign with up to five prospects through Scout, Researcher and Outreach; open one retained company and one rejected candidate.
2. Trace each research observation to its source URL, retrieval time and support; inspect the draft's evidence links and employee contributions.
3. Open run receipts with trigger, step outcome, timing, available usage and errors; reload the app.

Pass: records and artifacts persist, outputs are validated before being accepted, and absent website content is not falsely asserted as a missing business feature. Roles contribute through saved context. Untrusted website/email instructions cannot alter tool permission or authorize a send. Meaningful activity is recorded without fabricated chatter.

## Decisions and external email

### V13 — Required asks, durable waiting and version conflicts

1. Open a mission with a missing-information ask and an exact-draft approval. Reload while it waits and resolve only one required ask.
2. Open the same draft in two sessions. Edit recipient, subject or body in one; attempt approval of the old revision in the other.
3. Request changes, inspect the replacement revision, reject with a reason, and replay a successful resolution signal.

Pass: unresolved required asks keep their dependent work waiting durably. Obsolete revisions are rejected, edits invalidate approval, comments do not resolve approval, and repeated signals do not execute continuation twice. Approve/revise/reject histories identify actor, reason where required, revision and time.

### V14 — Independent prospects and parent completion

1. Run a five-prospect mission containing two contactable prospects, an unqualified candidate, a missing-contact candidate and a recoverable source failure.
2. Approve one contactable prospect and reject or request revision for the other. Observe each prospect's work and the parent mission summary.
3. Resolve or explicitly skip remaining work through the implemented controls.

Pass: per-prospect outcomes remain independent; one blocked/rejected candidate cannot silently block every approved candidate or disappear from counts. Each send has its own valid approval. Parent completion follows its declared promised outputs, with rejected/contact-needed/skipped reasons visible. Incoming replies create linked follow-on work instead of keeping the original mission open indefinitely.

### V15 — One real controlled email round trip

1. Select the controlled demonstration recipient, review exact recipient/subject/body/revision, and approve. Inspect the durable attempt created before transport.
2. Confirm receipt in the controlled inbox, reply from it, and watch the shared inbox update in both authorized sessions.
3. Inspect conversation ownership, reply classification, prospect update, next action and a contextual response draft.

Pass: one approved message reaches the intended inbox and one authentic reply is linked by provider references. The same workspace sender remains in use. Source evidence, approval, send receipt and incoming reply are traceable. A response draft does not send without its own required approval.

### V16 — Duplicate, invalid and out-of-order provider events

1. Replay a valid staging incoming event twice; send an invalid-signature request; replay a delivery-status event after a newer terminal event.
2. Deliver a reply before a delayed sent-status event. Deliver a valid message with no existing conversation association.
3. Confirm unmatched mail stays under human takeover without a reply workflow,
   draft or send. Associate it to a same-workspace lead as an owner/operator;
   reject viewer, cross-workspace and stale-version attempts. Confirm association
   alone does not dispatch; explicit resume checks sender/contact and policy and
   starts at most one reply workflow for the latest inbound message.

Pass: signature failures are rejected; valid duplicate events have one logical effect. Older statuses do not regress established transport state. Replies match the correct workspace/inbox/thread or enter an unassigned queue; email body text never selects the workspace. Component and application persistence do not maintain competing transport truth.

### V17 — Reply cancellation, takeover, pause and suppression

1. Prepare an approved follow-up, then receive a reply before dispatch. Repeat with human takeover, campaign/workspace pause and an unsubscribe.
2. Attempt send from a previously open approval screen after each state change. Explicitly resume a taken-over conversation only when appropriate.
3. Inspect normalized suppression matching and the conversation version used by scheduled work.

Pass: final send policy rechecks current state, invalidates obsolete work and stops suppressed recipients immediately. Takeover pauses automation until explicit resume; reply/suppression/pause changes affect already queued work. A previous approval alone cannot bypass current policy.

### V18 — Transport timeout, retry and reconciliation

1. Use the staging fault procedure to interrupt transport after a send request may have reached the provider but before its result is recorded.
2. Inspect the UI and attempt another send/approval of the same draft revision. Reconcile using the provider's supported lookup/idempotency mechanism or documented manual review path.
3. Separately exercise a definitely unsent failure and inspect the allowed recovery.
4. While a send is uncertain, revise and reapprove its draft, then attempt dispatch
   through the backend. The older unresolved attempt must still block it. Exercise
   the separate replacement decision with its exact draft binding and duplicate
   acknowledgement; stale, reused or generic approvals cannot grant that exception.

Pass: ambiguous outcomes display **Delivery uncertain** and prevent blind resend. Reconciliation links an existing delivery or establishes a safe next action; unresolved outcomes remain blocked. Component retries, Workflow retries and application recovery do not multiply an external send. No claim of exactly-once transport is made without verified provider support.

### V19 — Sending window and schedule occurrence ownership

1. Configure a timezone and sending window; approve outside that window, then observe behavior at the next allowed time under a small send allowance.
2. If user schedules ship, run one occurrence, replay its dispatch, pause the schedule and inspect its next execution. Cancel running work using its separate control.
3. Change schedule timezone/cadence while a prior occurrence is queued. Verify a DST boundary if a DST-observing timezone is supported.

Pass: final send enforces window and allowance. One schedule occurrence creates one workflow; obsolete schedule versions cannot dispatch. Pause blocks future starts without pretending to cancel current external work. Convex is the sole cadence owner; no ASCII/Codex scheduler competes for the same occurrence.

## Public demo and release evidence

### V20 — Public judge experience and abuse limits

1. Open the published URL in a fresh private browser and follow the documented judge access path without developer credentials.
2. Complete the constrained experience; try exceeding its request/cost cap and selecting a recipient outside the controlled allowlist.
3. Inspect access from a second judge session and the published source for exposed configuration values.

Pass: the judge can experience the product with clear access instructions. Demo isolation, provider budget and recipient restrictions are enforced on the backend. No public arbitrary shell, provider send path or shared personal credential is exposed. Prepared data, simulations and recorded fallbacks are visibly labeled; real execution claims match evidence.

### V21 — Three-minute recording rehearsal

- **0:00–0:20:** Open the `/leads` CRM home; show the agency offer, lead stages and campaign's five-prospect cap.
- **0:20–0:50:** Start or open the clearly labeled prepared research run; show a prospect's source-backed observation.
- **0:50–1:20:** Show Scout/Researcher/Outreach contributions and the exact draft approval.
- **1:20–1:55:** Send to the controlled inbox and reply from it; use an honestly labeled recorded continuation if provider latency requires it.
- **1:55–2:30:** Show the incoming reply, live CRM update and an approved response proposing meeting slots or the business's booking link.
- **2:30–2:50:** Show an honestly labeled controlled meeting confirmation with time, timezone and linked evidence; show the lead's next action and receipt. Leave ten seconds of margin.

Pass: the exported video is strictly under three minutes; UI text is readable; narration explains the user's outcome and actual Convex/ASCII/provider responsibilities. No private tokens, login codes or unrelated inbox contents appear.

### V22 — Release and hackathon evidence checklist

- Record the final commit and successful existing lint/build results; link completed V01–V21 and V23–V24 results and explicitly list blocked/omitted optional scenarios.
- Confirm the public repository can be opened without authentication and setup instructions are usable; inspect tracked files and artifacts for secrets and personal information.
- Refresh root `hackathon.md` from actual repository/work evidence, with honest chronology, implemented scope, sponsor/component usage, limitations and verification outcomes.
- Confirm the public `convex.site` or `chatgpt.site` application URL works for judges; attach the video under three minutes and documented social proof/user feedback. Prepare a sanitized fallback recording.
- Recheck the [official Convex All Gas Hackathon page](https://www.convex.dev/hackathons/all-gas) immediately before submission. The checked deadline is **September 22, 2026, 12:00 PM Pacific = 19:00 UTC = September 23, 2026, 00:30 IST**; allow upload time before that cutoff.
- Prepare the exact repository, app, video and evidence links as a reviewable submission packet. Building or verifying this packet does not itself publish, send messages, or submit it; follow the execution plan's authorization boundary for those actions.

Pass: submission materials match the current working release and official requirements. Every demonstrated capability has evidence; unfinished integration behavior is identified rather than presented as complete.

## CRM and booking: required core acceptance

### V23 — Lead ownership, stages, activity and next actions

1. After sign-in, open `/leads`; verify it is the CRM home and `/overview` remains the linked mission execution view. Trace a scraped/discovered company through qualification, outreach preparation, known accepted send and incoming reply.
2. Assign a lead owner, change a permitted CRM stage with its expected version/reason, set a dated next action and update it from another authorized session. Attempt a stale update, a viewer mutation and a cross-workspace owner assignment.
3. Inspect the lead's evidence, conversation, employee contributions, human changes and next-action history. Confirm automated stage updates follow verified facts and do not overwrite a later human decision without the declared conflict policy.
4. Use supported owner/stage/campaign filters and company-name search, plus the separate overdue-next-action mode, on a dataset larger than one page through the staging seed procedure. Verify search is scoped to the workspace, applies selected equality filters and pages by relevance; unsupported due-range/search combinations are unavailable. Page forward/back; change search/filter and confirm its cursor resets; open a lead link, reload, and return to the same list context. No test files are needed for this manual fixture.
5. Rediscover a known company under the documented deduplication policy, then close or disqualify a lead with a reason. Confirm its saved history remains accessible and an unrelated new run does not silently reopen it.

Pass: the CRM provides one coherent view of each lead's ownership, status, supporting activity and next action. Unauthorized or stale updates fail server-side. Mission completion does not imply contacted, booked or won; stage changes carry actor/source/time and the appropriate evidence. Indexed pagination and filters expose all matching records without loading an unbounded table or dropping list context. Follow-up dates and overdue labels use the displayed timezone.

### V24 — Propose, confirm and manage a real meeting outcome

1. From an interested controlled conversation, draft a response containing the business's configured booking link or explicit proposed slots with timezone. Review its exact recipient/body/revision, approve and send through the normal send boundary.
2. Open the link or receive an ambiguous reply such as “Tuesday works”; inspect booking state. Neither a clicked/shared link, proposed slot nor model classification may by itself confirm a meeting.
3. As an authorized human, record a meeting confirmation supported by the controlled reply or verified booking evidence, including date, start time, timezone, duration and evidence reference. Reload and inspect it in another timezone/session.
4. Try a missing timezone, invalid duration, nonexistent/ambiguous DST time and a stale confirmation version. Resolve ambiguity explicitly before saving; show the same meeting instant correctly in each supported timezone.
5. Reschedule with new supporting details, then cancel a separate confirmed meeting and record a no-show on another through the implemented human controls. Inspect history, lead status, next action and any obsolete scheduled work.
6. Attempt confirmation as a viewer, from another workspace and from untrusted email instructions. If no calendar integration has passed its gate, inspect UI wording and absence of any implied calendar availability or event creation.

Pass: proposed and confirmed meetings are distinct. Confirmation records who accepted the evidence and the exact agreed time; it does not claim an external calendar event exists. Reschedule/cancel/no-show changes are versioned, auditable and update related next actions without erasing history. Booking does not imply closed-won. Any external scheduling message needs its own exact approval; real calendar synchronization remains optional until independently verified.

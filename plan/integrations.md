# Integration runbook

Status: executable implementation plan; no provider account has been connected, no Box has been provisioned, and no message has been sent by this planning work. Documentation and public package metadata were checked on September 13, 2026. A documentation check is not a passed live integration gate.

## Decisions

- Run Codex App Server inside one isolated ASCII Box per connected workspace. Workspace owners connect their own Codex accounts there. This is the primary runtime and authentication route.
- Use Apollo MCP for company discovery, the Firecrawl Convex component for bounded website research, then Apollo MCP for business contact enrichment of qualified prospects. Start with five prospects and one eligible contact per prospect.
- Use Convex Workflow for durable sequencing, external-result waits, retries of eligible steps, and cancellation. Runtime assignment records are a bridge to external execution, not a second general-purpose queue or scheduler.
- Reuse `@agentmail/convex` for inbox creation/cache and verified inbound ingestion. Use a narrow OpenSquad send action with a provider HTTP idempotency header. Do not invoke the component's default outbound queue in this initial implementation.
- Keep final sending, approval state, suppression checks, and all AgentMail credentials in Convex. They must never enter the Box, employee prompts, or MCP tool configuration.
- Treat YC and TrustMRR discovery, broader crawling, screenshot audits, and follow-ups as gated additions after the primary conversation works.

These are OpenSquad design choices. The provider facts and the implementation checks behind them follow.

## Version and credential inventory

Registry observations are candidate pins, not a compatibility claim. The existing repository uses pnpm, ESM, and Convex `^1.45.0`. Keep its React/Vite structure. Record the exact resolved version and lockfile integrity in the G1–G3 evidence before executing paid calls.

| Dependency/service | Observed version or surface | Execution location | Credential ownership |
|---|---|---|---|
| `@openai/codex` | Registry `0.154.0`; generate protocol types from the installed binary | ASCII worker package | Owner's managed Codex login, isolated per workspace |
| `@asciidev/box-sdk` | Registry `0.0.34`; REST v1 also available | Convex server action/control service | Application service key; never passed into customer Boxes |
| `@convex-dev/workflow` | Registry `0.4.7`; peers include Convex `^1.36.1`, Workpool `^0.4.4`, convex-helpers `^0.1.99` | Convex | No separate provider credential |
| `@agentmail/convex` | Registry `0.1.0`; peers Convex `^1.24.8`, convex-helpers `^0.1.106` | Convex component | Deployment `AGENTMAIL_API_KEY` and `AGENTMAIL_WEBHOOK_SECRET` |
| AgentMail REST | `/v0` | Narrow Convex action only | Same application-managed email account; one assigned inbox per workspace |
| Apollo MCP | Hosted Streamable HTTP/OAuth; no package pin | Trusted tool gateway for the workspace | Workspace owner's separate Apollo OAuth grant |
| `@firecrawl/firecrawl-convex` | Registry `0.1.1`; requires Convex `^1.43.0` | Convex, selected research route | `FIRECRAWL_API_KEY`, `FIRECRAWL_WEBHOOK_SECRET` |

The pins above came from the public npm registry, including [Box SDK](https://registry.npmjs.org/@asciidev%2fbox-sdk/latest), [Workflow](https://registry.npmjs.org/@convex-dev%2fworkflow/latest), [AgentMail component](https://registry.npmjs.org/@agentmail%2fconvex/latest), [Firecrawl component](https://registry.npmjs.org/@firecrawl%2ffirecrawl-convex/latest), and [Codex](https://registry.npmjs.org/@openai%2fcodex/latest). Re-query before installation if implementation starts on another day.

Run these read-only checks from the project before choosing pins:

```sh
pnpm --version
node --version
pnpm view @asciidev/box-sdk version
pnpm view @convex-dev/workflow version peerDependencies
pnpm view @agentmail/convex version peerDependencies
pnpm view @firecrawl/firecrawl-convex version peerDependencies
pnpm view @openai/codex version
```

Install only the selected routes once their owner is implementing them. Add exact versions to the relevant package and save the resulting lockfile. The worker's Codex binary belongs in its separate package/image, not the browser dependency graph. Install the Firecrawl component for the selected backend-owned research route; do not also configure a direct employee MCP connection. Run the repository's existing build and lint commands; this plan does not require writing automated tests.

Secrets must be supplied through the selected provider's dashboard or the deployment's secret-input mechanism. Keep only names in `.env.example`; never paste actual secrets into a command shown in a public build log. Normal Convex records store connection status and ownership references. An OAuth gateway may require a server-only encrypted credential store; validate that storage design at G2 and keep ciphertext inaccessible to normal client queries.

### Environment destinations

These names form the OpenSquad configuration contract to implement in P01/P07;
provider SDK constructors must receive the corresponding value explicitly when
their own defaults use a different name. No real `.env.local` was read for this plan.

| Destination | Names / data | Rule |
|---|---|---|
| Vite build configuration | `VITE_CONVEX_URL`, `VITE_HEXCLAVE_PROJECT_ID`, `VITE_HEXCLAVE_PUBLISHABLE_CLIENT_KEY` | Public project/client configuration only; verify the installed Hexclave key requirement |
| Local Convex CLI | `CONVEX_DEPLOYMENT` | Existing deployment selection; do not overwrite it to create an anonymous project |
| Convex deployment settings | `VITE_HEXCLAVE_PROJECT_ID` | Existing `convex/auth.config.ts` reads this public project ID on the backend too |
| Convex server-only settings | `ASCII_API_KEY`, `FIRECRAWL_API_KEY`, `FIRECRAWL_WEBHOOK_SECRET`, `AGENTMAIL_API_KEY`, `AGENTMAIL_WEBHOOK_SECRET` | Never public `VITE_*`; use installed component configuration schema |
| Convex demo policy | `OPENSQUAD_DEMO_ALLOWED_RECIPIENTS`, `OPENSQUAD_DEMO_MAX_DAILY_SENDS` | Backend-validated normalized recipient list and hard cap; absence disables public-demo send; normal workspace owners cannot expand them |
| Runtime provisioning | `OPENSQUAD_BRIDGE_URL`, `OPENSQUAD_RUNTIME_ID`, `OPENSQUAD_RUNTIME_GENERATION`, `OPENSQUAD_WORKER_TOKEN` | Bridge uses the deployment's HTTP `.convex.site` origin; injected workspace credential, not deploy key |
| Isolated runtime storage | Codex managed login cache; Apollo gateway OAuth grant | Dedicated protected service-user files; not repository files, browser local storage or build artifacts |
| Owner-only temporary challenge | Provider URL/code, expiry and login-request reference | Short-lived app query for that owner; delete after completion/cancel/expiry; never public events |
| Release tooling only | `CONVEX_DEPLOY_KEY` if the chosen release flow needs it | Deployment tooling secret; never Box or Vite |

The read-only public tour uses sanitized projections. Live execution requires
the workspace's own connected runtime and permissions. No `OPENAI_API_KEY` is
required for the primary managed-Codex path; an API-funded fallback is a separate
explicit configuration/funding decision.

## G1 — ASCII runtime and per-workspace Codex connection

### Provision and restore

ASCII exposes lifecycle through `https://ascii.dev/api/box/v1`. Create/fork accepts an `Idempotency-Key`; the same key and body recover an accepted request for 24 hours. Poll until `ready` or `idle` before starting a command. A Box's `idle` status does not reflect work run through a custom daemon; OpenSquad must use its own worker heartbeat to decide whether work is active. [ASCII API](https://docs.ascii.dev/box/api/v1)

Use `noEnv: true` at initial creation. ASCII documents that this withholds inherited account credentials. Build the reusable image without any customer login, and never fork a connected customer Box into another workspace. Converting a previously unprotected Box may scrub Codex credential files, including a user's own login; start protected and validate the normal protected resume path. [ASCII environments](https://docs.ascii.dev/box/environments)

Implement these lifecycle operations in a server-only adapter, with request/response validators and a persisted operation ID:

| Operation | Verified REST contract | OpenSquad behavior |
|---|---|---|
| Create | `POST /boxes`, body includes `noEnv`, `ttlSeconds`, `env`; optional `from` for a verified clean named snapshot | Save a stable creation key before request; inject only the worker's workspace credential and neutral IDs; save returned Box ID |
| Inspect | `GET /boxes/{boxId}` | Poll with bounded backoff; distinguish provisioning, archived, error, and ready |
| Bootstrap | `POST /boxes/{boxId}/commands` with command/cwd | Install or verify the pinned worker; start the service; do not repeat ambiguous commands automatically |
| Resume | `POST /boxes/{boxId}/resume` | Resume the same Box; poll; require a fresh worker heartbeat and connection check before dispatch |
| Extend TTL | `PATCH /boxes/{boxId}`, body `ttlSeconds` | Set an explicit limit appropriate for the active work; record intended stop time |
| Pause | `POST /boxes/{boxId}/stop` | Drain or explicitly interrupt work, persist state, stop, and verify archived state |
| Delete | `DELETE /boxes/{boxId}` | Execute only for an explicit workspace/runtime deletion; mark the connection unrecoverable after success |

Method names and typed request wrappers are documented in the [ASCII TypeScript SDK](https://docs.ascii.dev/box/sdks/typescript). Verify the installed SDK's exports and header support; use the documented HTTP endpoint if the pinned SDK lacks an idempotency option. Do not guess a wrapper signature from an older sample.

ASCII stop/resume restores the filesystem and restarts enabled systemd services, but not manually started processes. Its default one-hour TTL counts from creation and can interrupt active work. Trial accounts cannot disable auto-stop or exceed two hours. [Long-running tasks](https://docs.ascii.dev/box/long-running-tasks)

OpenSquad worker requirements:

1. Package a fixed worker executable and pinned Codex binary. Run the worker as a systemd service under a dedicated unprivileged account.
2. Have the worker own the App Server child process through stdio. Do not expose the raw App Server or its credential files on a public port.
3. Keep provider OAuth credentials in a trusted gateway/supervisor account, separate from employee-accessible files. Do not enable unrestricted shell execution in the sales workflow.
4. Scope the worker credential to one workspace, runtime generation, and allowed reporting/claim operations. Convex derives workspace ownership from that credential; a submitted workspace ID never grants access.
5. Report worker version, runtime generation, current turn ID, and heartbeat time. Persist accepted external results before acknowledging completion to the worker.
6. Resume a saved Codex thread only after verifying it belongs to that employee/workspace. Keep shared sales context in Convex.
7. Accept a model result only when its execution ID and generation still match. Duplicate completion may acknowledge the existing result; it must not create a second prospect or draft.
8. An expired lease does not prove the old turn stopped. Confirm interrupt completion or Box stop before starting a replacement; otherwise mark Needs attention and do not start a concurrent model run.

ASCII supports installing a custom daemon instead of using its built-in prompt harness. An optional private hosted endpoint still needs authentication and token redaction. Prefer outbound worker polling for this demo to avoid exposing that endpoint. [Platform guide](https://docs.ascii.dev/box/platform-guide)

### Codex authentication checks

Connect the workspace owner's account inside its own Box with the managed App Server login flow. The frontend receives a login URL/code and connection status, not credentials. Check connection after service restart, Box resume, account disconnect, and account limit exhaustion. Use the installed binary's generated protocol definitions for request types and responses. The primary references are [Codex App Server](https://learn.chatgpt.com/docs/app-server) and [Codex authentication](https://learn.chatgpt.com/docs/auth).

Run inside the candidate Box image to establish the available binary and schema tooling:

```sh
codex --version
codex app-server --help
codex app-server generate-ts --help
codex mcp --help
```

These inspection commands are verified against the locally available CLI surface; running the equivalent commands in ASCII is still a gate. Do not infer headless login success from a working desktop login. Do not copy the builder's auth files. The login protocol, OAuth refresh across a reboot, and the accepted hosted-use pattern must all pass before multi-customer activation.

### G1 acceptance

P03 proves create/readiness, owner login, one bounded model turn and filesystem/auth/service resume using a fixed development worker. The lease-expiry/UI/credential-scope portions below are integrated P07/P14 gates. They are not prerequisites of P03. Record the two sets separately.

Execute against one disposable, explicitly allocated workspace runtime:

- Create with a persisted idempotency key, repeat the identical create request, and confirm one Box ID. Keep the request body identical.
- Confirm readiness and worker heartbeat; confirm inherited builder credentials are absent using presence checks only, without printing file contents or environment values.
- Complete owner login; run one short structured-output turn; store its real IDs and sanitized result.
- Save a harmless marker file, pause normally, resume, and verify marker persistence, fresh service heartbeat, managed login status, and a resumed thread turn.
- Expire an external assignment while a turn is deliberately held; verify the UI reports Needs attention until termination is confirmed. No second model run may overlap.
- Record durations, CLI version, Box ID reference, and pass/fail results in the integration evidence. Do not store auth URLs with tokens or raw protocol dumps containing personal data.

Failure action: keep runtime-dependent campaigns disabled and show the concrete reason. Repair the ASCII/Codex path; do not silently switch account identity or execution provider. UI work and controlled local validation may continue independently.

### Codex login and agent-run protocol to implement

The documented App Server sequence is initialize/initialized, account inspection,
managed login, then thread and turn requests. Device-code login returns a
verification URL/code and emits completion/account notifications. Schema generation
is tied to the binary version; plugin install APIs are marked under development.
Use a fixed MCP setup instead. [Official protocol](https://learn.chatgpt.com/docs/app-server)

Device login may need enabling in ChatGPT account security/workspace settings.
It must succeed in the chosen hosted environment; do not assume subscription
access implies a supported shared unattended service. [Official auth](https://learn.chatgpt.com/docs/auth)

Verified local CLI: `codex-cli 0.154.0`. Execute in the clean worker image:

```bash
codex --version
codex app-server generate-ts --out worker/src/generated/codex
codex app-server generate-json-schema --out worker/protocol
codex app-server --stdio
```

The final command starts the child server; the worker writes newline-delimited
requests to its stdin and routes responses by ID while reading notifications.
Do not paste this sequence into a shell as standalone commands:

```json
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"opensquad_worker","version":"0.1.0"}}}
{"method":"initialized","params":{}}
{"id":2,"method":"account/read","params":{"refreshToken":false}}
{"id":3,"method":"account/login/start","params":{"type":"chatgptDeviceCode"}}
```

OpenSquad's implementation sequence:

1. Owner calls `runtimeConnections.connect` after app membership validation.
   Provision/resume its protected Box; enqueue a versioned owner-control command
   in `runtimeControlRequests`. The worker polls `/worker/control/claim` separately
   from model work, so login can proceed before there is a campaign run.
2. Worker checks account state first. If already connected for this workspace,
   report a safe summary; otherwise issue managed login. Store only the login
   request reference and connection state in normal records. Deliver the actual
   URL/code in an owner-only short-lived challenge record with expiry/redaction;
   never expose it in a board subscription or activity feed.
3. The human opens the provider URL and signs in. Only a matching successful
   `account/login/completed`, followed by a fresh account read, can set Ready.
   Expiry/cancel is recoverable; duplicate/old generation events are ignored.
   Never collect a ChatGPT password in OpenSquad or copy builder credential files.
4. Before a model run, claim the workspace slot and check account readiness plus
   available rate-limit metadata using `account/rateLimits/read`. Missing metadata
   is unknown, not unlimited. Exceeding access limits blocks work; no automatic
   account switch, credit purchase or reset-credit consumption.
5. Create/resume the employee's scoped thread with `thread/start` or `thread/resume`.
   Save its returned ID. Call `turn/start` with the bounded task context, selected
   available model, output contract and enforced tool/sandbox policy from generated
   types. Never hardcode a model that the account has not shown to be available.
6. Forward only allowlisted progress summaries and usage receipts. Wait for the
   terminal turn event, validate the structured result and submit it through
   `/worker/result` with current lease/generation. UI streaming is not completion.
7. On timeout/cancel call `turn/interrupt`; confirm termination before releasing
   the slot or stopping the Box. After restart, inspect/resume persisted thread
   state; do not repeat a paid tool action whose prior outcome is unknown.
8. Owner disconnect queues `account/logout`, revokes runtime capabilities and
   clears pending challenges. Confirm logout before reporting disconnected.
   Stop preserves only workspace-owned state; explicit deletion removes the Box
   after its active work is terminated. Persistent filesystem cleanup and provider
   grant revocation are separate actions recorded by the owner-control flow.

The owner-control bridge is application code to build in P07. `claim` returns
one of `inspect_account|start_login|cancel_login|logout|interrupt_turn` with command
ID, runtime generation, expiry and narrowly scoped arguments. `/worker/control/result`
accepts matching versioned completion and sanitized status. Enforce one outstanding
login command per runtime; make repeats idempotent, hash worker credentials and
reject stale generations. A role prompt cannot issue an owner-control command.

Gate: P03 proves the provider sequence in a fixed runtime; P07 proves these
owner-facing controls, restart/revocation and isolation in the application.

## G2 — Discovery, research, and enrichment

### Apollo OAuth and tool gateway

Apollo documents `https://mcp.apollo.io/mcp`, Streamable HTTP, OAuth 2.0, and no API-key requirement for the standalone connection. It documents Codex configuration and `codex mcp login apollo`. Search and enrichment are separate; enrichment uses account credits. Apollo requires model training to be disabled and describes a separate OAuth-app registration path for partner integrations. Its MCP can also send email and manage sequences. [Apollo MCP](https://docs.apollo.io/docs/apollo-mcp)

Implement connection as a workspace-owned grant in the trusted tool gateway. The desktop plugin's connection is not transferable proof. For the first diagnostic session, a trusted operator can configure the gateway's isolated Codex client with:

```toml
[mcp_servers.apollo]
url = "https://mcp.apollo.io/mcp"
```

Then authenticate that isolated client:

```sh
codex mcp login apollo
```

Do not place that raw connection into the employee process used by public customers. OpenSquad must expose only a filtered gateway connection to the model. Capture the exact tool names and input schemas returned by `tools/list`; they are not hardcoded in this plan because they have not been observed in the actual account.

Gateway implementation contract:

1. Bind every connection to a workspace and every call to an active execution capability issued by Convex.
2. Permit company search, person search, and the chosen business-email enrichment tool only. Block email creation/sending, enrollment, sequences, tasks, contact writes, and unknown new tools by default.
3. Reserve a bounded operation allowance transactionally before forwarding each paid action. A duplicate invocation ID returns its recorded result/status. Ambiguous failures consume the reservation until reconciled.
4. Maintain a hard count of enrichment requests, separate from observed provider credits. Do not promise an exact financial cap when the provider's tariff or account rules are unknown.
5. Reject enrichment until Convex has accepted qualification evidence for that prospect. The gateway reloads the allowed company/contact identity from trusted records.
6. Ensure the employee cannot read gateway OAuth tokens or change the gateway policy through shell commands, filesystem tools, environment inspection, or another raw MCP route.
7. Verify the real remote OAuth redirect/callback and refresh path in ASCII. If a registered partner app is required for the chosen customer-hosted experience, resolve that prerequisite before enabling it. A local loopback callback working on a laptop is insufficient evidence.

Direct MCP OAuth forwarding, token refresh through the gateway, exact Apollo tool names, and partner-registration applicability remain unverified. G2 must demonstrate these; do not mark the integration connected from config presence alone.

### Primary campaign operation order

| Step | Provider route | Accepted output and bound |
|---|---|---|
| Discover | Apollo company search through gateway | At most five companies; canonical website domain, provider ID, source reference, selection reason |
| Research | Firecrawl Convex component via authorized backend operations | Homepage and up to two relevant pages per company; URL, retrieval time, concise excerpt, supported observation |
| Qualify | Codex structured result, validated by Convex | Fit decision, evidence references, confidence, rejection/unknown reasons |
| Identify contact | Apollo people search through gateway | A relevant business role matched to the saved company domain |
| Enrich | One chosen Apollo enrichment operation | At most one person per qualified company; exact provider email/status when returned, otherwise Contact needed |
| Draft | Codex, using saved evidence and contact | Recipient and exact subject/body proposed to OpenSquad; no send tool |

The initial policy disables personal-email reveal, phone reveal, and waterfall enrichment. Apollo's direct enrichment documentation shows phone/waterfall operations can require asynchronous callbacks and additional charging rules; do not assume MCP parameters behave identically. Inspect the selected MCP schema and return data before mapping this policy. [People enrichment](https://docs.apollo.io/reference/people-enrichment)

### Firecrawl route

Use `@firecrawl/firecrawl-convex` for the first research slice. It supplies search/scrape/map interfaces and durable crawl state with callback/poll recovery. OpenSquad supplies authorization, prospect ownership, budgets and evidence decisions. Read the installed exports and callback types before writing its adapter. [Component source](https://github.com/firecrawl/firecrawl-convex), [catalog](https://www.convex.dev/components/firecrawl/firecrawl-convex)

1. Register the component and configure its server-side API key and webhook secret. Reserve `/firecrawl/` for its callbacks and keep static hosting fallback separate. Use provider-reachable callbacks; document poll fallback if a development deployment cannot receive them.
2. Backend validates the campaign/domain, reserves page/search allowance and requests at most the homepage plus two useful public pages per prospect. Use the installed bounded scrape operation for an immediate page; if it returns a crawl/job reference, wait through Workflow for its completion instead of holding an action or model turn open.
3. Record component request references and accepted pages against the prospect/run. The component owns crawl lifecycle; OpenSquad owns source-backed observations, concise briefs and storage ownership.
4. Dispatch Researcher in Codex only after the pages are ready. Its OpenSquad research tool can read scoped results or propose another bounded URL; it cannot read a Firecrawl secret or invoke a second direct MCP research route.
5. Validate public HTTP(S) URLs and redirect targets in OpenSquad-controlled fetching; reject local/private/credential-bearing targets. Restrict provider crawls to the approved domain and page/depth limits. Missing or truncated content stays explicitly unknown.
6. Check actual callback signature verification and result completion semantics against the pinned source, including a duplicate callback and a workflow resume without a second crawl. Do not infer site completeness from a successful HTTP response.

Firecrawl MCP remains an alternative for a separately chosen integration change, not an additional route for these same operations. Record that change in the plan before enabling it.

### G2 acceptance

P04 runs a fixed-input, trusted-operator provider probe: actual Apollo auth/search, one Firecrawl page, one qualified-contact request, observed schemas and a demonstrated allowlist mechanism. Save sanitized local outputs if domain records are not built. The production gateway, transactional budgets, tenant storage and Workflow-resume checks below are P07/P09/P14 gates, not prerequisites of P04.

1. In the actual ASCII runtime, complete the gateway OAuth flow and enumerate the real Apollo tool schemas and installed Firecrawl component interfaces. Record only capability names and version/status metadata.
2. Run one company search, research one matching public website, then enrich one qualified business contact. Confirm source domain, person/company match, evidence, and provider status survive saving/reloading.
3. Repeat a gateway invocation ID and show no second paid request. Exhaust a deliberately small allowance and show that the next call is rejected before it reaches the provider.
4. Attempt a blocked Apollo operation through a harmless capability check, without submitting an actual send. Show that the employee has no callable outbound route and cannot access the raw credentials/configuration.
5. Restart the runtime and gateway, confirm the same workspace account remains connected, and verify a second workspace cannot read or call that grant.
6. Try a no-result contact and an inaccessible page. Both must produce explicit partial results without guessed emails or fabricated evidence.

Failure action: leave the failing source/capability unavailable with a visible reason. Do not broaden tools to bypass missing access. Use labeled prepared data for interface work; prepared data does not satisfy the live gate.

### Source-specific additions

For YC or TrustMRR, first validate three named public listings against their displayed source pages. Confirm domain, source URL, retrieval date, and the campaign's requested filters. For revenue, preserve metric name, currency, and period independently; skip anonymous companies. Do not infer eligibility from a name match. Enable that source only after this sample and extraction limits are recorded. The primary Apollo route remains executable while either additional source is unavailable.

## G3 — Approved send and inbound conversation

### Why outbound uses a narrow adapter

The inspected `@agentmail/convex@0.1.0` tarball enqueues sends in a Workpool and its send action has no application preflight hook. Its fetch helper does not attach an HTTP idempotency key. The component's pending cancellation cannot withdraw a request already in flight. Therefore, its default sender is not the selected approval boundary. This finding was checked against the published tarball and matching [send implementation](https://github.com/agentmail-to/convex/blob/46bde1a9132599760f425b55c9e29d5ba86ea7df/src/component/lib.ts) and [HTTP helper](https://github.com/agentmail-to/convex/blob/46bde1a9132599760f425b55c9e29d5ba86ea7df/src/component/utils.ts).

AgentMail supports `Idempotency-Key` on send, reply, forward, and draft-send HTTP requests. Replaying the same key and exact request returns the original IDs; a changed request produces a conflict. The organization-scoped key expires 24 hours after completion. [Idempotency contract](https://docs.agentmail.to/idempotency)

### Implement one outbound action

1. Store draft revisions immutably with the exact inbox, recipient, subject/body, and reply parent if applicable. Editing creates a new revision and invalidates old approval.
2. Keep the send waiting in Convex Workflow until its window is due. Do not enqueue it into another provider queue while waiting.
3. Immediately before the HTTP call, invoke one Convex transaction to validate the approved revision, workspace/campaign status, suppression, allowed demo recipient, conversation version, takeover state, rate allowance, no successful attempt for the draft and no unresolved attempt across conversation revisions. Only the architecture's recorded, single-use replacement decision may cover a prior uncertain attempt; a new revision/approval alone cannot.
4. The transaction saves a send attempt, a unique durable idempotency key, exact payload fingerprint, endpoint, inbox, and dispatch timestamp. It establishes the dispatch boundary: pause/takeover prevents future dispatch; it cannot recall an HTTP request already sent. Reflect that distinction in the UI.
5. Execute one `fetch` attempt to the documented endpoint with the key in the **HTTP request headers**. The payload's `headers` field means email headers; it is not HTTP idempotency. Use `POST /v0/inboxes/{inbox_id}/messages/send` for first contact and the documented reply endpoint for a response in an existing conversation. [Send API](https://docs.agentmail.to/api-reference/inboxes/messages/send)
6. Disable generic SDK and Workflow retries around the sending action. A timeout, process loss, malformed success response, or lost database acknowledgement becomes uncertain rather than an automatic new send.
7. On a confirmed success, save provider message/thread IDs. The immutable approved content supplies the local outgoing body; provider events supply delivery facts.
8. If policy still permits sending and provider idempotency remains within its verified window, an explicit reconciliation operation may replay the exact same request/key. This can initiate delivery if the first request never arrived; it is not a read-only lookup. If paused, suppressed, replied, or expired, use provider read APIs/events to investigate and require human review instead. Never generate a fresh key for an unresolved attempt.
9. Do not claim delivered from HTTP 200. Show Sent until a verified delivery event establishes Delivered. Preserve bounce/complaint details as facts, and suppress future outreach where policy requires.

The adapter is deliberately small: send/reply HTTP, durable attempt metadata, and response reconciliation. It does not implement a separate inbox service or duplicate every provider table.

### Reuse the AgentMail component for inbound mail

Register the component in Convex and mount `agentmail.handleWebhook` on `/agentmail/webhook`. Configure `onMessageReceived` and `onEvent` as internal mutations. It verifies Svix headers over the raw body and rejects invalid signatures. [Webhook verifier](https://github.com/agentmail-to/convex/blob/46bde1a9132599760f425b55c9e29d5ba86ea7df/src/client/webhook.ts)

The component stores inbound bodies and deduplicates provider `event_id` before dispatching callbacks through a separate pool. Remote thread metadata uses provider actions. Finalized component outbound rows expire after seven days; never depend on that store for long-lived approval/audit history. [AgentMail component guide](https://github.com/agentmail-to/convex)

OpenSquad callbacks must:

- Resolve workspace exclusively from a saved inbox assignment and provider references. Unknown inboxes are quarantined; unmatched known-inbox messages enter that workspace's unassigned queue under human takeover, with no reply workflow/draft/send until authorized lead association and explicit resume.
- Deduplicate sales-side handling by inbox/message ID as well as event ID. A repeated provider message with another event ID must not start a second response workflow.
- Update the conversation version, suppress unsubscribe requests, and invalidate due follow-up dispatch before starting response drafting.
- Signal or start the appropriate Convex Workflow using the accepted event identifier. Component callback execution is not proof the sales workflow completed.
- Retain a small replay/reconciliation record so failed callback handling is visible and recoverable; do not build another general webhook ingestion store.
- Track delivery events against OpenSquad's provider message reference because the app-owned sender does not create a component outbound row. Store unmatched early delivery events and reconcile after the send result arrives.
- Guard every exported email query/action with workspace ownership. Components cannot infer the current application's sales permissions from caller-supplied inbox/thread IDs.

Use a deterministic `clientId` when provisioning an inbox. AgentMail distinguishes resource-creation idempotency from sending; do not substitute that field for the send header. [Duplicate-prevention guide](https://docs.agentmail.to/knowledge-base/preventing-duplicate-sends)

### G3 acceptance

P05 is transport-only: provision a controlled inbox, verify webhook authentication, submit an explicitly authorized fixed payload through a private spike, receive/reply, and confirm provider idempotency/duplicate delivery behavior. It does not require application approvals, takeover UI or reply drafting. Steps 3–4 and full application portions of 6–8 below belong to P10/P11/P14. Keep that evidence separate and remove the private spike before public release.

Use an explicitly selected sender inbox and a controlled recipient. This plan does not authorize contacting discovered prospects during setup.

1. Create/recover one inbox with the same logical client ID. Save its workspace mapping and confirm cross-workspace access is rejected.
2. Register the actual Convex HTTP webhook URL; record the secret only in Convex's secret configuration. Verify an invalid signature changes no state.
3. Create a draft and approve its exact revision. Edit the body or recipient and confirm sending is blocked until that new revision is approved.
4. Exercise pause, takeover, suppression, and stale conversation checks before dispatch. Verify no HTTP send is issued for each blocked case.
5. Send one approved controlled message through the narrow action; record message/thread IDs. Replay the same request/key while the controlled workflow remains eligible and confirm the same IDs and one received message. A changed request with that key should conflict.
6. Reply from the controlled mailbox. Confirm the verified inbound appears live, associates to the same conversation, invalidates any pending response/follow-up, and produces an unsent response draft.
7. Replay a signed inbound event through the provider's supported delivery/replay mechanism and confirm one sales-side transition. Inspect event ordering and reconcile a delivery event arriving before the local send acknowledgement.
8. Exercise the uncertain-attempt branch without sending to a second recipient. Confirm generic retry paths do not issue a new request/key and the UI exposes Needs attention.

Keep controlled email addresses, raw body content, auth material, and full provider webhook payloads out of public gate evidence. Save enough internal IDs/statuses to review the actual outcome.

Failure action: disable sends globally, retain readable inbox/draft UI, fix the sender/webhook issue, and repeat only the failed gate. No live send should depend on “probably idempotent” behavior.

## G4 — Public delivery handoff

P16 owns G4. The observed `@convex-dev/static-hosting` version is `0.2.1`, with
the `static-hosting` executable. Its integration guide supports Vite, SPA fallback,
development uploads and a production deploy command. [Hosting guide](https://github.com/get-convex/static-hosting/blob/main/INTEGRATION.md)

After reviewing the selected version and when implementing P16:

```bash
pnpm add --save-exact @convex-dev/static-hosting@0.2.1
pnpm exec static-hosting setup
# Inspect generated config/scripts before proceeding.
pnpm exec convex dev --once --typecheck enable
pnpm exec static-hosting upload --build
# Production publication only for the authorized, reviewed target:
pnpm exec static-hosting deploy
```

Choose **app-owned root routing**: preserve the current root-level worker/mail
paths and register the static fallback after those routes, using the installed
`registerStaticRoutes` interface. Do not accept a setup change that silently moves
application HTTP endpoints under `/api`; update all callback/bridge URLs first
if a later explicit migration chooses that topology.

| Public path | Owner |
|---|---|
| `/worker/*` | Exact authenticated application worker/control routes |
| `/agentmail/webhook` | Signed AgentMail receiver |
| `/firecrawl/*` | Registered component callback prefix |
| `/`, `/leads`, `/overview`, sign-in/handler and other UI routes | Vite static app with SPA fallback |

Do not treat `.convex.cloud` (client query endpoint) as the frontend or webhook
origin. Validate that the build embeds the selected deployment URL and public
Hexclave configuration, and that HTTP callbacks/worker bridge use `.convex.site`.
Configure production allowed origins and redirect settings, run direct-route
refresh checks, then repeat a controlled conversation. Record the actual URL,
worker image/version, release commit and callback validation in P16 evidence.

Rollback procedure to record during P16: pause new dispatch, retain the prior
frontend artifact and compatible backend commit, stop incompatible workers,
redeploy that known-good version to the same selected deployment, and resume only
after auth/bridge/webhook checks. Avoid destructive schema changes during release;
existing data must remain readable by the rollback revision. Do not present an
unverified provider rollback command as if it were supported.

Verify a public visitor can use the constrained demo without gaining arbitrary shell access, other workspaces' records, provider tokens, or unrestricted send destinations. Repeat one controlled conversation on the published deployment. A development URL or a recorded video does not establish that production provider callbacks work.

## Evidence and handoff

For each gate, record date, executor, environment, selected versions, named probe, actual outcome, sanitized provider/reference IDs, and remaining limitations in the plan's evidence ledger. Passing a static build is separate from passing a provider probe.

The next executor should be able to answer these from the recorded evidence before enabling a real campaign:

- Which exact runtime and gateway versions ran, and whose Codex/Apollo grants do they use?
- Did protected Box resume preserve usable auth and restart the worker?
- Where is each provider allowance enforced, and can employee tools bypass it?
- Which sender path sets HTTP idempotency, and what happens when the acknowledgement is lost?
- Can the same signed inbound message produce more than one draft/follow-up transition?
- Which workflow/execution is active, and what proves an old worker stopped before replacement?

The gates are manual integration probes and build/lint validation. Do not add test files unless the user asks for them.

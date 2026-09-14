#!/usr/bin/env bash
# P10 manual probe driver — stages a workspace/campaign/mission/conversation
# on the ISOLATED local deployment and exercises the P10 contracts.
# Usage: scripts/p10-probe.sh <step> [suffix]
# Never runs against the shared cloud deployment: convex CLI resolves the
# local deployment from this worktree's .env.local.
set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
source /Users/honey/Code/opensquad/.env.local
ISS="https://api.hexclave.com/api/v1/projects/$VITE_HEXCLAVE_PROJECT_ID"
SFX="${P10SFX:-$(date +%s)}"
OWNER_SUB="p10-owner-$SFX"
ID_OWNER="{\"subject\":\"$OWNER_SUB\",\"issuer\":\"$ISS\",\"name\":\"P10 Owner\"}"

SENDER="opensquad-p05-probe@agentmail.to"         # controlled inbox (P05 probe)
RECIPIENT="repulsivebicycle137@agentmail.to"    # controlled inbox (P10 probe)

STATE_DIR="/tmp/p10-probe-$SFX"
mkdir -p "$STATE_DIR"

# convex run prints "Already up to date / Done in …" before the payload;
# failures print "✖ Failed …" + "Error: {json}". Show payloads AND errors,
# and propagate the run's exit status so callers never save a null id.
cr() { # cr <fn> <args-json> [identity-json]
  local out rc
  out=$(pnpm exec convex run "$1" "$2" ${3:+--identity "$3"} 2>&1)
  rc=$?
  echo "$out" | sed -n '/^{/,$p'
  echo "$out" | grep -E '^(✖|Error:)' | sed 's/^/  /' >&2
  if [ "$rc" -ne 0 ] || echo "$out" | grep -qE '^(✖|Error:)'; then
    echo "  probe step failed (rc=$rc): $1" >&2
    return 1
  fi
}

# Save/load fixture ids between steps.
save() { echo "$2" > "$STATE_DIR/$1"; }
load() { cat "$STATE_DIR/$1" 2>/dev/null; }

step="${1:-fixture}"

case "$step" in

fixture)
  WS=$(cr workspaces:ensureWorkspace "{\"name\":\"P10 Probe $SFX\",\"timezone\":\"UTC\"}" "$ID_OWNER" | jq -r .workspaceId)
  save ws "$WS"; save owner "$ID_OWNER"
  cr workspaces:setSendingPolicy "{\"workspaceId\":\"$WS\",\"expectedPolicyVersion\":1,\"dailySendLimit\":50,\"sendWindow\":{\"weekdays\":[0,1,2,3,4,5,6],\"startMinute\":0,\"endMinute\":1439}}" "$ID_OWNER" | jq '{policyVersion, dailySendLimit, sendWindow}'
  cr workspaces:setAutomationState "{\"workspaceId\":\"$WS\",\"state\":\"active\"}" "$ID_OWNER" | jq '{automationState}'
  cr internal.drafts.assignWorkspaceInbox "{\"workspaceId\":\"$WS\",\"inboxRef\":\"$SENDER\"}" ""
  CAMP=$(cr campaigns:create "{\"workspaceId\":\"$WS\",\"title\":\"P10 probe campaign\",\"brief\":\"probe\",\"sourcePlan\":{\"instruction\":\"probe\",\"sources\":[{\"source\":\"apollo\",\"filters\":{}}]},\"leadLimit\":5,\"enrichmentLimit\":1}" "$ID_OWNER" | jq -r ._id)
  save camp "$CAMP"
  cr campaigns:confirmSourcePlan "{\"workspaceId\":\"$WS\",\"campaignId\":\"$CAMP\",\"expectedBriefVersion\":1,\"sources\":[{\"source\":\"apollo\",\"filters\":{}}]}" "$ID_OWNER" | jq '{status, confirmed: (.sourcePlan.confirmedBy != null)}'
  cr campaigns:setState "{\"workspaceId\":\"$WS\",\"campaignId\":\"$CAMP\",\"state\":\"active\"}" "$ID_OWNER" | jq '{status}'
  MISSION=$(cr missions:create "{\"workspaceId\":\"$WS\",\"campaignId\":\"$CAMP\",\"kind\":\"sales_campaign\",\"title\":\"P10 probe mission\"}" "$ID_OWNER" | jq -r ._id)
  save mission "$MISSION"
  CONV=$(cr internal.drafts.stageConversation "{\"workspaceId\":\"$WS\",\"inboxRef\":\"$SENDER\",\"providerThreadRef\":\"thread-$SFX\"}" "" | jq -r ._id)
  save conv "$CONV"
  echo "FIXTURE ws=$WS camp=$CAMP mission=$MISSION conv=$CONV"
  ;;

draft)
  WS=$(load ws); MISSION=$(load mission); CONV=$(load conv); ID_OWNER=$(load owner)
  DRAFT=$(cr internal.drafts.createRevision "{\"conversationId\":\"$CONV\",\"missionId\":\"$MISSION\",\"recipient\":\"$RECIPIENT\",\"subject\":\"P10 probe v1\",\"body\":\"Controlled probe body v1.\",\"evidenceIds\":[\"ev-1\",\"ev-2\"]}" "" )
  echo "$DRAFT" | jq '{_id, revision, normalizedRecipient, payloadHash, basedOnContextVersion, campaignBriefVersion, policyVersion}'
  save draft "$(echo "$DRAFT" | jq -r ._id)"
  # find the open draft_approval decision
  DEC=$(cr decisions:listForMission "{\"workspaceId\":\"$WS\",\"missionId\":\"$MISSION\"}" "$ID_OWNER" | jq -r '.items[] | select(.kind=="draft_approval" and .state=="open") | ._id' | head -1)
  save dec "$DEC"
  echo "draft=$(load draft) decision=$DEC"
  ;;

show-decision)
  WS=$(load ws); ID_OWNER=$(load owner); DEC=$(load dec)
  cr decisions:get "{\"workspaceId\":\"$WS\",\"decisionId\":\"$DEC\"}" "$ID_OWNER" | jq '{_id,kind,state,version,draftId,askKey,targetWorkflowId,continuationEventId,answer,resolvedBy,workflowGeneration}'
  ;;

approve)
  WS=$(load ws); ID_OWNER=$(load owner); DEC=$(load dec); REQ="${2:-approve-$SFX}"
  cr approvals:approve "{\"workspaceId\":\"$WS\",\"decisionId\":\"$DEC\",\"expectedVersion\":1,\"requestId\":\"$REQ\"}" "$ID_OWNER" | jq '{approval: {id: .approval._id, decision: .approval.decision, payloadHash: .approval.payloadHash, contextVersion: .approval.contextVersion}, replayed}'
  ;;

approve-wrongver)
  WS=$(load ws); ID_OWNER=$(load owner); DEC=$(load dec)
  cr approvals:approve "{\"workspaceId\":\"$WS\",\"decisionId\":\"$DEC\",\"expectedVersion\":99,\"requestId\":\"ap-wrongver-$SFX\"}" "$ID_OWNER"
  ;;

revise)
  WS=$(load ws); ID_OWNER=$(load owner); DRAFT=$(load draft)
  D=$(cr drafts:revise "{\"workspaceId\":\"$WS\",\"draftId\":\"$DRAFT\",\"expectedRevision\":1,\"subject\":\"P10 probe v2 (revised)\",\"body\":\"Controlled probe body v2 — changed content.\",\"requestId\":\"revise-$SFX\"}" "$ID_OWNER")
  echo "$D" | jq '{_id, revision, payloadHash, subject, basedOnContextVersion, supersededAt}'
  save draft "$(echo "$D" | jq -r ._id)"
  # new open decision
  MISSION=$(load mission)
  DEC=$(cr decisions:listForMission "{\"workspaceId\":\"$WS\",\"missionId\":\"$MISSION\"}" "$ID_OWNER" | jq -r '.items[] | select(.kind=="draft_approval" and .state=="open") | ._id' | head -1)
  save dec "$DEC"
  echo "draft=$(load draft) decision=$DEC"
  ;;

revise3)
  WS=$(load ws); ID_OWNER=$(load owner); DRAFT=$(load draft)
  D=$(cr drafts:revise "{\"workspaceId\":\"$WS\",\"draftId\":\"$DRAFT\",\"expectedRevision\":2,\"body\":\"Controlled probe body v3 — approved content for sending.\",\"requestId\":\"revise3-$SFX\"}" "$ID_OWNER")
  echo "$D" | jq '{_id, revision, payloadHash, basedOnContextVersion}'
  save draft "$(echo "$D" | jq -r ._id)"
  MISSION=$(load mission)
  DEC=$(cr decisions:listForMission "{\"workspaceId\":\"$WS\",\"missionId\":\"$MISSION\"}" "$ID_OWNER" | jq -r '.items[] | select(.kind=="draft_approval" and .state=="open") | ._id' | head -1)
  save dec "$DEC"
  echo "draft=$(load draft) decision=$DEC"
  ;;

request-changes)
  WS=$(load ws); ID_OWNER=$(load owner); DEC=$(load dec)
  cr approvals:requestChanges "{\"workspaceId\":\"$WS\",\"decisionId\":\"$DEC\",\"expectedVersion\":1,\"requestId\":\"reqchg-$SFX\",\"comment\":\"Please tighten the opener.\"}" "$ID_OWNER" | jq '{verdict: .approval.decision, replayed}'
  ;;

send)
  DRAFT=$(load draft)
  cr internal.sending.sendApprovedDraft "{\"draftId\":\"$DRAFT\"}" ""
  ;;

get-attempt)
  WS=$(load ws); ID_OWNER=$(load owner); CONV=$(load conv)
  cr sendAttempts:listForConversation "{\"workspaceId\":\"$WS\",\"conversationId\":\"$CONV\"}" "$ID_OWNER" | jq '[.[] | {_id, state, operationKey, endpointOperation, providerIdempotencyKey, providerMessageRef, payloadHash, error, replacementDecisionId}]'
  ;;

inbound)
  CONV=$(load conv)
  cr internal.drafts.applyInboundContext "{\"conversationId\":\"$CONV\",\"lastInboundMessageRef\":\"<sim-inbound-$SFX@agentmail.to>\"}" "" | jq '{contextVersion, lastInboundMessageRef, unreadCount}'
  ;;

pause)
  WS=$(load ws); ID_OWNER=$(load owner)
  cr workspaces:setAutomationState "{\"workspaceId\":\"$WS\",\"state\":\"paused\",\"reason\":\"probe pause\"}" "$ID_OWNER" | jq '{automationState}'
  ;;

unpause)
  WS=$(load ws); ID_OWNER=$(load owner)
  cr workspaces:setAutomationState "{\"workspaceId\":\"$WS\",\"state\":\"active\"}" "$ID_OWNER" | jq '{automationState}'
  ;;

takeover)
  WS=$(load ws); CONV=$(load conv)
  cr internal.drafts.stageConversation "{\"workspaceId\":\"$WS\",\"conversationId\":\"$CONV\",\"inboxRef\":\"$SENDER\",\"humanTakeover\":true}" "" | jq '{humanTakeover}'
  ;;

untakeover)
  WS=$(load ws); CONV=$(load conv)
  cr internal.drafts.stageConversation "{\"workspaceId\":\"$WS\",\"conversationId\":\"$CONV\",\"inboxRef\":\"$SENDER\",\"humanTakeover\":false}" "" | jq '{humanTakeover}'
  ;;

suppress-email)
  WS=$(load ws); ID_OWNER=$(load owner)
  cr suppressions:add "{\"workspaceId\":\"$WS\",\"kind\":\"email\",\"value\":\"$RECIPIENT\",\"reason\":\"unsubscribe\"}" "$ID_OWNER" | jq '{suppression: {kind: .suppression.kind, value: .suppression.normalizedValue, reason: .suppression.reason}, created}'
  ;;

suppress-domain)
  WS=$(load ws); ID_OWNER=$(load owner)
  cr suppressions:add "{\"workspaceId\":\"$WS\",\"kind\":\"domain\",\"value\":\"agentmail.to\",\"reason\":\"manual\"}" "$ID_OWNER" | jq '{suppression: {kind: .suppression.kind, value: .suppression.normalizedValue}, created}'
  ;;

unsuppress)
  WS=$(load ws); ID_OWNER=$(load owner)
  IDS=$(cr suppressions:list "{\"workspaceId\":\"$WS\"}" "$ID_OWNER" | jq -r '.[]._id')
  for id in $IDS; do cr suppressions:remove "{\"workspaceId\":\"$WS\",\"suppressionId\":\"$id\"}" "$ID_OWNER" > /dev/null; done
  echo "cleared suppressions"
  ;;

list-suppressions)
  WS=$(load ws); ID_OWNER=$(load owner)
  cr suppressions:list "{\"workspaceId\":\"$WS\"}" "$ID_OWNER" | jq '[.[] | {kind, normalizedValue, reason}]'
  ;;

usage)
  WS=$(load ws); ID_OWNER=$(load owner)
  cr usage:summary "{\"workspaceId\":\"$WS\"}" "$ID_OWNER"
  ;;

narrow-window)
  WS=$(load ws); ID_OWNER=$(load owner)
  # current policy version
  PV=$(cr workspaces:get "{\"workspaceId\":\"$WS\"}" "$ID_OWNER" | jq -r .policyVersion)
  cr workspaces:setSendingPolicy "{\"workspaceId\":\"$WS\",\"expectedPolicyVersion\":$PV,\"sendWindow\":{\"weekdays\":[0,1,2,3,4,5,6],\"startMinute\":1438,\"endMinute\":1439}}" "$ID_OWNER" | jq '{policyVersion, sendWindow}'
  ;;

wide-window)
  WS=$(load ws); ID_OWNER=$(load owner)
  PV=$(cr workspaces:get "{\"workspaceId\":\"$WS\"}" "$ID_OWNER" | jq -r .policyVersion)
  cr workspaces:setSendingPolicy "{\"workspaceId\":\"$WS\",\"expectedPolicyVersion\":$PV,\"sendWindow\":{\"weekdays\":[0,1,2,3,4,5,6],\"startMinute\":0,\"endMinute\":1439}}" "$ID_OWNER" | jq '{policyVersion, sendWindow}'
  ;;

bad-url)
  pnpm exec convex env set AGENTMAIL_BASE_URL "http://127.0.0.1:9" 2>&1 | tail -1
  ;;

good-url)
  pnpm exec convex env unset AGENTMAIL_BASE_URL 2>&1 | tail -1
  ;;

reconcile)
  ATT="${2:-$(load attempt)}"
  cr internal.sending.reconcileUncertainAttempt "{\"sendAttemptId\":\"$ATT\"}" ""
  ;;

evidence)
  ATT="${2:-$(load attempt)}"
  cr internal.sending.gatherProviderEvidence "{\"sendAttemptId\":\"$ATT\"}" ""
  ;;

sweep)
  WS=$(load ws)
  cr internal.sending.sweepStaleAttempts "{\"workspaceId\":\"$WS\",\"staleAfterMs\":0}" ""
  ;;

begin-only)
  ATT="${2:-$(load attempt)}"
  cr internal.sending.beginDispatch "{\"sendAttemptId\":\"$ATT\"}" "" | jq '{action, key: .providerIdempotencyKey, code}'
  ;;

reserve-only)
  DRAFT="${2:-$(load draft)}"
  cr internal.sending.reserveSendIntent "{\"draftId\":\"$DRAFT\"}" "" | jq '{action, code, sendAttemptId, state}'
  ;;

record-outcome)
  # record-outcome <attemptId> <json-result>
  cr internal.sending.recordSendOutcome "{\"sendAttemptId\":\"$2\",\"result\":$3}" "" | jq '.attempt | {_id, state, providerMessageRef, providerDeliveryFacts, error}'
  ;;

park-event)
  # park-event <providerMessageRef> <eventType> [eventId]
  WS=$(load ws)
  cr internal.sendAttempts.recordProviderEvent "{\"workspaceId\":\"$WS\",\"inboxRef\":\"$SENDER\",\"providerEventId\":\"${4:-evt-$SFX-$RANDOM}\",\"applicationKey\":\"outbound:$2:$3\",\"providerMessageRef\":\"$2\",\"eventType\":\"$3\",\"providerFacts\":{\"timestamp\":$(date +%s000)},\"providerThreadRef\":\"thread-$SFX\"}" "" | jq '{receipt: {state: .receipt.handlingState, key: .receipt.applicationKey}, duplicate, duplicateApplicationKey}'
  ;;

list-receipts)
  WS=$(load ws); ID_OWNER=$(load owner)
  cr sendAttempts:listReceipts "{\"workspaceId\":\"$WS\"}" "$ID_OWNER" | jq '[.[] | {providerEventId, applicationKey, eventType, handlingState, providerMessageRef}]'
  ;;

resolve-uncertain)
  # resolve-uncertain <decisionId> <replacementDraftId>
  WS=$(load ws); ID_OWNER=$(load owner)
  cr sending:resolveDeliveryUncertainty "{\"workspaceId\":\"$WS\",\"decisionId\":\"$2\",\"expectedVersion\":1,\"requestId\":\"repl-$SFX\",\"reason\":\"Replace after provider evidence review — original never arrived.\",\"replacementDraftId\":\"$3\",\"acknowledgeDuplicate\":true}" "$ID_OWNER" | jq '{resolved, replayed, dispatched}'
  ;;

resolve-uncertain-keep)
  # resolve-uncertain-keep <decisionId> — acknowledge, leave unresolved
  WS=$(load ws); ID_OWNER=$(load owner)
  cr sending:resolveDeliveryUncertainty "{\"workspaceId\":\"$WS\",\"decisionId\":\"$2\",\"expectedVersion\":1,\"requestId\":\"keep-$SFX\",\"reason\":\"Reviewed — leave uncertain, no replacement.\"}" "$ID_OWNER" | jq '{resolved, replayed, dispatched}'
  ;;

list-decisions)
  WS=$(load ws); ID_OWNER=$(load owner); MISSION=$(load mission)
  cr decisions:listForMission "{\"workspaceId\":\"$WS\",\"missionId\":\"$MISSION\"}" "$ID_OWNER" | jq '[.items[] | {_id, kind, state, askKey, draftId, sendAttemptId, version}]'
  ;;

*)
  echo "unknown step: $step" >&2; exit 2;;
esac

/**
 * "Is this address our own mailbox?" — one answer, used everywhere the
 * question is asked.
 *
 * THE PROVIDER KEEPS THE ID AND THE ADDRESS APART. `plan/spikes.md` records
 * the Inbox object as `{ pod_id, inbox_id, email }`: the id and the mailbox
 * address are separate fields, and the connect flow reads both. Comparing an
 * inbound `From` against `orgs.inboxRef` alone therefore rests on the id
 * happening to BE the address — true for AgentMail's default domain, not a
 * contract — so the address is persisted at connect (`orgs.inboxAddress`) and
 * this compares against BOTH. Either match means the mail is ours; neither
 * can be manufactured by a sender, because both values come from the
 * connection, never from a payload.
 *
 * ALWAYS CASE-INSENSITIVE. Addresses compare case-insensitively and the
 * provider may echo `Sales@Acme.com` where the connection stored
 * `sales@acme.com`; `sameInboxRef` is the one definition of that.
 */
import type { Doc } from "../_generated/dataModel";
import { parseInboundSender, sameInboxRef } from "../lib/validators";

/**
 * Every string that names this org's own mailbox: the stored reference, the
 * stored address, and the normalized form of each (a display-name wrapper
 * like `Sales <sales@acme.com>` normalizes to the bare address).
 *
 * An org connected before `inboxAddress` existed simply contributes one
 * fewer candidate — the fallback is the previous behaviour exactly.
 */
export function ownMailboxIdentifiers(
  org: Pick<Doc<"orgs">, "inboxRef" | "inboxAddress"> | null | undefined,
): string[] {
  if (org === null || org === undefined) {
    return [];
  }
  const values: string[] = [];
  for (const candidate of [org.inboxRef, org.inboxAddress]) {
    if (candidate === undefined) {
      continue;
    }
    values.push(candidate);
    const parsed = parseInboundSender(candidate);
    if (parsed !== undefined) {
      values.push(parsed);
    }
  }
  return values;
}

/**
 * Was this inbound message written by us?
 *
 * It can only ever REFUSE work (an echo is not a reply), so an unknown or
 * unparseable address answers `false` and the message goes on to the other
 * checks.
 */
export function isOwnMailbox(
  org: Pick<Doc<"orgs">, "inboxRef" | "inboxAddress"> | null | undefined,
  address: string | undefined,
): boolean {
  if (address === undefined) {
    return false;
  }
  return ownMailboxIdentifiers(org).some((candidate) =>
    sameInboxRef(candidate, address),
  );
}

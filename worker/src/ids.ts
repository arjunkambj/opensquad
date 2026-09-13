// ID minting for bridge correlation (requestId/resultId/eventId).
import { randomBytes } from "node:crypto";

/** `<prefix>_<22 base62 chars>` — bounded, unguessable, log-safe. */
export function mintBridgeId(prefix: string): string {
  const alphabet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = randomBytes(22);
  let id = "";
  for (const byte of bytes) {
    id += alphabet[byte % alphabet.length];
  }
  return `${prefix}_${id}`;
}

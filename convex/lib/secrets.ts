/**
 * The envelope every bring-your-own provider secret is stored in
 * (PLAN §4 "Bring-your-own keys").
 *
 * AES-256-GCM under ONE deployment key, `SECRETS_ENCRYPTION_KEY`. The expected
 * value is **32 random bytes, base64-encoded** — for example
 * `openssl rand -base64 32` — and nothing else is accepted: a key of the wrong
 * length is a configuration mistake that would otherwise silently weaken every
 * stored secret, so it fails closed with a typed error at the first use rather
 * than encrypting under it.
 *
 * WHERE THIS MAY RUN. `crypto.subtle` is available in Convex mutations too, but
 * decryption is deliberately confined to actions and HTTP actions: a mutation
 * that can produce plaintext is a mutation whose return value can carry it to a
 * client. The only readers here are `convex/inbox/connection.ts`,
 * `convex/inbox/backfill.ts` and the send boundary in
 * `convex/integrations/agentmail.ts`, all of them internal actions.
 *
 * WHAT NEVER LEAVES. Plaintext is returned to the caller and passed straight to
 * a provider request; it is never stored, never logged and never placed in a
 * function return that reaches a client. `secretLast4` is the only projection a
 * client query may show.
 */
import { domainError } from "./validators";

/** Deployment env var holding the base64 AES-256 key. */
export const SECRETS_ENCRYPTION_KEY_ENV = "SECRETS_ENCRYPTION_KEY";

/** AES-256: the only key size this module accepts. */
const AES_KEY_BYTES = 32;

/** GCM's standard 96-bit nonce — fresh per encryption, never reused. */
const GCM_IV_BYTES = 12;

/** How much of a key a connected workspace may show (PLAN §4). */
export const SECRET_LAST4_LENGTH = 4;

/** Longest provider secret this module will wrap. */
export const SECRET_PLAINTEXT_MAX_LENGTH = 512;

/** The stored halves of one encrypted secret, both base64. */
export type SecretEnvelope = { ciphertext: string; iv: string };

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string, field: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw domainError("INVALID", `${field} is not valid base64`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Whether the deployment is configured to hold secrets at all. Read by the
 * connect path so the UI can say "this deployment cannot store keys yet"
 * instead of failing at the moment a real key has already been pasted.
 */
export function isSecretStorageConfigured(): boolean {
  const raw = process.env[SECRETS_ENCRYPTION_KEY_ENV];
  if (raw === undefined) {
    return false;
  }
  try {
    return fromBase64(raw.trim(), SECRETS_ENCRYPTION_KEY_ENV).length ===
      AES_KEY_BYTES;
  } catch {
    return false;
  }
}

async function deploymentKey(): Promise<CryptoKey> {
  const raw = process.env[SECRETS_ENCRYPTION_KEY_ENV];
  if (raw === undefined || raw.trim().length === 0) {
    // FORBIDDEN, not INVALID: nothing the caller sent is wrong. The same code
    // `lib/auth.expectedUsersIssuer` uses for a missing deployment setting.
    throw domainError(
      "FORBIDDEN",
      `${SECRETS_ENCRYPTION_KEY_ENV} is not set on this deployment, so provider keys cannot be stored`,
    );
  }
  const bytes = fromBase64(raw.trim(), SECRETS_ENCRYPTION_KEY_ENV);
  if (bytes.length !== AES_KEY_BYTES) {
    throw domainError(
      "FORBIDDEN",
      `${SECRETS_ENCRYPTION_KEY_ENV} must be ${AES_KEY_BYTES} random bytes, base64-encoded`,
    );
  }
  return await crypto.subtle.importKey(
    "raw",
    bytes as unknown as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Wrap one provider secret. A fresh IV per call; both halves base64. */
export async function encryptSecret(
  plaintext: string,
): Promise<SecretEnvelope> {
  if (plaintext.length === 0) {
    throw domainError("INVALID", "a provider key cannot be empty");
  }
  if (plaintext.length > SECRET_PLAINTEXT_MAX_LENGTH) {
    throw domainError(
      "INVALID",
      `a provider key must be at most ${SECRET_PLAINTEXT_MAX_LENGTH} characters`,
    );
  }
  const key = await deploymentKey();
  const iv = new Uint8Array(GCM_IV_BYTES);
  crypto.getRandomValues(iv);
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
    key,
    new TextEncoder().encode(plaintext) as unknown as ArrayBuffer,
  );
  return { ciphertext: toBase64(new Uint8Array(sealed)), iv: toBase64(iv) };
}

/**
 * Unwrap one stored secret. A GCM authentication failure means the envelope
 * was written under a DIFFERENT deployment key (or altered), which is not a
 * transient condition — it is reported as such so the caller asks for a
 * reconnect rather than retrying forever.
 */
export async function decryptSecret(
  envelope: SecretEnvelope,
): Promise<string> {
  const key = await deploymentKey();
  const iv = fromBase64(envelope.iv, "iv");
  const ciphertext = fromBase64(envelope.ciphertext, "ciphertext");
  let opened: ArrayBuffer;
  try {
    opened = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
      key,
      ciphertext as unknown as ArrayBuffer,
    );
  } catch {
    throw domainError(
      "FORBIDDEN",
      "the stored key could not be decrypted with this deployment's secret key — reconnect the inbox",
    );
  }
  return new TextDecoder().decode(opened);
}

/**
 * The only part of a key a client ever sees. Short keys are padded rather
 * than revealed: a four-character secret would otherwise be shown whole.
 */
export function secretLast4(plaintext: string): string {
  const trimmed = plaintext.trim();
  return trimmed.length <= SECRET_LAST4_LENGTH
    ? "•".repeat(SECRET_LAST4_LENGTH)
    : trimmed.slice(-SECRET_LAST4_LENGTH);
}

/**
 * The `sendAttempts` row as the client sees it — the validator the send
 * boundary's `returns` contracts share (architecture §4.3, §8).
 */
import { sendAttemptFields } from "../schema";
import { v } from "convex/values";

export const vSendAttemptDoc = v.object({
  _id: v.id("sendAttempts"),
  _creationTime: v.number(),
  ...sendAttemptFields,
});

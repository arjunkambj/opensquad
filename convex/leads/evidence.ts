/**
 * Evidence — one observation with the source it came from (§4.3/§4.5).
 *
 * A row is only ever synthesized from the BACKEND'S OWN retrieval, never from
 * a model field: `sourceUrl`, `retrievedAt` and `excerpt` come from the
 * `providerOperations` receipt Convex wrote when it paid for the page, and
 * `confidence` defaults to `unknown` unless the basis can be stated
 * mechanically. This module defines the document validator used by lead reads.
 */
import { v } from "convex/values";
import { evidenceFields } from "../schema";

export const vEvidenceDoc = v.object({
  _id: v.id("evidence"),
  _creationTime: v.number(),
  ...evidenceFields,
});

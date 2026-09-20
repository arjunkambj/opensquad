/**
 * Domain validators, re-exported.
 *
 * This is the one barrel in the codebase (PLAN §10): every backend module
 * imports validators from `lib/validators`, and the domain files below are
 * the single definition site for each vocabulary. Add a validator to the file
 * that owns its domain — never to this one.
 */
export * from "./shared";
export * from "./activity";
export * from "./agents";
export * from "./billing";
export * from "./bookings";
export * from "./company";
export * from "./inbox";
export * from "./leads";
export * from "./outreach";
export * from "./workspaces";

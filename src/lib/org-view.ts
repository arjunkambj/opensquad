import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";

/**
 * The organization as the browser receives it. Not `Doc<"orgs">`: the server
 * keeps the inbound-mail path token and the provider's webhook id to itself,
 * so components type against what the query actually returns.
 */
export type OrgView = FunctionReturnType<typeof api.orgs.queries.get>;

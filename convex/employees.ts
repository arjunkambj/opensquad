/**
 * Employee records — Scout, Researcher and Outreach per workspace
 * (architecture §4.1/§9). Reads require any active member; edits require
 * owner or operator. `allowedCapabilities` is intersected with the enforced
 * host policy: a workspace can only narrow it, never widen it.
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireWorkspaceEditor, requireWorkspaceMember } from "./lib/auth";
import {
  boundedString,
  domainError,
  intersectCapabilities,
  vCapabilityId,
} from "./lib/validators";
import type { CapabilityId } from "./lib/validators";
import { employeeFields } from "./schema";

export const vEmployeeDoc = v.object({
  _id: v.id("employees"),
  _creationTime: v.number(),
  ...employeeFields,
});

/** All three template employees for the workspace. */
export const list = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(vEmployeeDoc),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    return await ctx.db
      .query("employees")
      .withIndex("by_workspaceId_and_template", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .collect();
  },
});

/** One employee; foreign or cross-workspace IDs return `NOT_FOUND`. */
export const get = query({
  args: {
    workspaceId: v.id("workspaces"),
    employeeId: v.id("employees"),
  },
  returns: vEmployeeDoc,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const employee = await ctx.db.get("employees", args.employeeId);
    if (employee === null || employee.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "employee not found");
    }
    return employee;
  },
});

/**
 * Edit name, instructions, enabled flag or the capability preference.
 * `expectedInstructionVersion` must match the current version; it increments
 * only when the instruction text actually changes.
 */
export const update = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    employeeId: v.id("employees"),
    expectedInstructionVersion: v.number(),
    name: v.optional(v.string()),
    instructions: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    allowedCapabilities: v.optional(v.array(vCapabilityId)),
  },
  returns: vEmployeeDoc,
  handler: async (ctx, args) => {
    await requireWorkspaceEditor(ctx, args.workspaceId);
    const employee = await ctx.db.get("employees", args.employeeId);
    if (employee === null || employee.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "employee not found");
    }
    if (employee.instructionVersion !== args.expectedInstructionVersion) {
      throw domainError(
        "CONFLICT",
        `instructionVersion is ${employee.instructionVersion}, not ${args.expectedInstructionVersion}`,
      );
    }

    const patch: {
      name?: string;
      instructions?: string;
      instructionVersion?: number;
      enabled?: boolean;
      allowedCapabilities?: CapabilityId[];
      updatedAt: number;
    } = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      patch.name = boundedString(args.name, "name", { min: 1, max: 100 });
    }
    if (args.instructions !== undefined) {
      const instructions = boundedString(args.instructions, "instructions", {
        min: 1,
        max: 8000,
      });
      patch.instructions = instructions;
      if (instructions !== employee.instructions) {
        patch.instructionVersion = employee.instructionVersion + 1;
      }
    }
    if (args.enabled !== undefined) {
      patch.enabled = args.enabled;
    }
    if (args.allowedCapabilities !== undefined) {
      patch.allowedCapabilities = intersectCapabilities(
        employee.template,
        args.allowedCapabilities,
      );
    }

    await ctx.db.patch("employees", employee._id, patch);
    const updated = await ctx.db.get("employees", employee._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "employee not found");
    }
    return updated;
  },
});

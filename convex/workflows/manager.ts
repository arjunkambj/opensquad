/**
 * Shared WorkflowManager — architecture §2/§6.2. One manager instance per
 * component registration; workflow definitions live in `devFixture.ts`
 * (P06 machinery gate) and, later, the real mission pipelines (P09/P11).
 */
import { WorkflowManager } from "@convex-dev/workflow";
import { components } from "../_generated/api";

export const workflow = new WorkflowManager(components.workflow);

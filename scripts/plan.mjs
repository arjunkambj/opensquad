#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const plan = JSON.parse(read("plan/tasks.json"));
const cards = read("plan/tasks.md");
const tasks = plan.tasks;
const byId = new Map(tasks.map((task) => [task.id, task]));
const statuses = new Set(["pending", "in_progress", "blocked", "done", "skipped"]);
const taskStarts = [...cards.matchAll(/^## (P\d{2}) — .+$/gm)];

function cardFor(id) {
  const index = taskStarts.findIndex((match) => match[1] === id);
  if (index === -1) return null;
  return cards.slice(taskStarts[index].index, taskStarts[index + 1]?.index).trim();
}

/**
 * Commit SHAs an evidence string cites that this repository does not contain.
 * Git-optional by design: outside a checkout (the portable handoff case) there
 * is nothing to resolve against, so the check yields nothing rather than
 * failing a plan that is fine.
 */
function resolvableShas(text) {
  // At least one digit: it keeps English words that happen to be hex
  // ("defaced", "effaced") out of the candidate set. A genuine all-letter SHA
  // goes unchecked, which costs a missed check rather than a false alarm.
  const candidates = [...new Set(text.match(/\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/g) ?? [])];
  if (!candidates.length) return [];
  let known;
  try {
    known = execFileSync("git", ["cat-file", "--batch-check"], {
      cwd: root,
      input: `${candidates.join("\n")}\n`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    return [];
  }
  const lines = known.trimEnd().split("\n");
  return candidates.filter((_, index) => / missing$/.test(lines[index] ?? " missing"));
}

function check() {
  const errors = [];
  if (plan.version !== 1 || !Array.isArray(tasks) || tasks.length === 0) {
    errors.push("Expected a version 1 plan with nonempty tasks.");
  }
  if (byId.size !== tasks.length) errors.push("Task IDs must be unique.");
  const declared = new Set(taskStarts.map((match) => match[1]));
  if (declared.size !== taskStarts.length) errors.push("Duplicate task card.");
  for (const id of declared) {
    if (!byId.has(id)) errors.push(`${id}: task card has no tracker entry.`);
  }
  for (const task of tasks) {
    if (!/^P\d{2}$/.test(task.id)) errors.push(`Invalid task ID: ${task.id}`);
    if (!statuses.has(task.status)) errors.push(`${task.id}: invalid status.`);
    if (!["core", "stretch"].includes(task.tier)) errors.push(`${task.id}: invalid tier.`);
    if (!task.title || !cardFor(task.id)) errors.push(`${task.id}: missing title/card.`);
    const cardDependencies = cardFor(task.id)?.match(/^Dependencies: ([^.]+)\./m);
    if (!cardDependencies) errors.push(`${task.id}: missing task-card dependency declaration.`);
    if (cardDependencies && Array.isArray(task.dependsOn)) {
      const declaredDependencies = cardDependencies[1].match(/P\d{2}/g) ?? [];
      if (declaredDependencies.length !== task.dependsOn.length ||
          declaredDependencies.some((dependency) => !task.dependsOn.includes(dependency))) {
        errors.push(`${task.id}: task-card dependencies differ from the tracker.`);
      }
    }
    for (const field of ["dependsOn", "evidence", "files", "skills"]) {
      if (!Array.isArray(task[field])) errors.push(`${task.id}: ${field} must be an array.`);
    }
    for (const dependency of task.dependsOn ?? []) {
      if (!byId.has(dependency)) errors.push(`${task.id}: unknown dependency ${dependency}.`);
      if (dependency === task.id) errors.push(`${task.id}: cannot depend on itself.`);
      if (["in_progress", "done"].includes(task.status) && byId.get(dependency)?.status !== "done") {
        errors.push(`${task.id}: ${task.status} task requires completed ${dependency}.`);
      }
    }
    if (task.status === "done") {
      const evidence = (task.evidence ?? []).filter((item) => typeof item === "string" && item.trim());
      if (!evidence.length) {
        errors.push(`${task.id}: completion requires acceptance evidence.`);
      } else if (!existsSync(resolve(root, `plan/evidence/${task.id}.md`))) {
        // A citation the reviewer cannot open is not evidence. This is the
        // cheapest guard against a completed task whose record is a sentence.
        errors.push(`${task.id}: completion requires plan/evidence/${task.id}.md.`);
      }
      for (const sha of resolvableShas(evidence.join(" "))) {
        errors.push(`${task.id}: evidence cites unknown commit ${sha}.`);
      }
    }
    if (task.status === "in_progress" && !task.owner?.trim()) {
      errors.push(`${task.id}: in-progress task requires an owner.`);
    }
    if (task.status === "blocked" && !task.blocker?.trim()) {
      errors.push(`${task.id}: blocked task requires a concrete blocker.`);
    }
    if (task.status === "skipped" && (task.tier !== "stretch" || !task.evidence?.length)) {
      errors.push(`${task.id}: only stretch tasks with a reason may be skipped.`);
    }
  }

  const visited = new Set();
  const visiting = new Set();
  function visit(id) {
    if (visiting.has(id)) {
      errors.push(`Dependency cycle at ${id}.`);
      return;
    }
    if (visited.has(id) || !byId.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const task of tasks) visit(task.id);

  const documents = [
    "AGENTS.md", "plan/README.md", "plan/tasks.md", "plan/architecture.md",
    "plan/integrations.md", "plan/verification.md", "plan/skills.md", "plan/worktrees.md",
    ".agents/skills/opensquad-build/SKILL.md",
    ".agents/skills/convex-hackathon-skill/SKILL.md",
  ];
  for (const path of documents) {
    if (!existsSync(resolve(root, path))) {
      errors.push(`Missing handoff file: ${path}`);
      continue;
    }
    for (const match of read(path).matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].split("#")[0];
      if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
      if (!existsSync(resolve(root, dirname(path), target))) {
        errors.push(`${path}: missing linked file ${target}`);
      }
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
}

function dependenciesDone(task) {
  return task.dependsOn.every((id) => byId.get(id).status === "done");
}

function prompt(task) {
  return `Use $opensquad-build to execute ${task.id}: ${task.title}. Read AGENTS.md, ` +
    "the task card, plan/worktrees.md and referenced specifications. Work in the " +
    "assigned worktree, complete the slice and its manual acceptance, then hand " +
    `off the branch and plan/evidence/${task.id}.md to the integrator. The integrator ` +
    "merges and updates canonical task status and hackathon.md. Do not write tests. " +
    "Respect existing external-action authorization.";
}

try {
  check();
  const [command = "status", id, ...extra] = process.argv.slice(2);
  if (extra.length || (command !== "show" && id)) throw new Error("Unexpected arguments.");
  if (command === "check") {
    console.log(`Plan valid: ${tasks.length} task cards, acyclic dependencies, local links and evidence rules checked.`);
  } else if (command === "status") {
    for (const task of tasks) {
      const ready = task.status === "pending" && dependenciesDone(task) ? " [ready]" : "";
      const suffix = task.tier === "stretch" ? " [optional]" : "";
      console.log(`${task.id} ${task.status.padEnd(11)} ${task.title}${ready}${suffix}`);
    }
    console.log(`\n${tasks.filter((task) => task.status === "done").length}/${tasks.length} done. Completion is recorded evidence, not automated certification.`);
  } else if (command === "next") {
    for (const task of tasks.filter((item) => item.status === "in_progress")) {
      console.log(`Resume ${task.id} (${task.owner}): ${task.title}`);
    }
    const ready = tasks.filter((task) => task.status === "pending" && dependenciesDone(task));
    for (const task of ready) {
      console.log(`\n${task.id}${task.tier === "stretch" ? " (optional)" : ""}: ${task.title}`);
      console.log(`Read: pnpm plan show ${task.id}\n${prompt(task)}`);
    }
    if (!ready.length) console.log("No pending task is ready. Inspect in-progress tasks or documented blockers.");
    for (const task of tasks.filter((item) => item.status === "blocked")) {
      console.log(`Blocked ${task.id}: ${task.blocker}`);
    }
  } else if (command === "show") {
    const task = byId.get(id);
    if (!task) throw new Error(`Unknown task: ${id ?? "(missing ID)"}`);
    console.log(`${task.id}: ${task.status}; owner: ${task.owner || "unclaimed"}`);
    console.log(`Dependencies: ${task.dependsOn.map((dependency) => `${dependency}=${byId.get(dependency).status}`).join(", ") || "none"}`);
    console.log(`Skills: ${task.skills.join(", ")}\nFiles: ${task.files.join(", ")}`);
    if (task.blocker) console.log(`Blocker: ${task.blocker}`);
    console.log(`\n${cardFor(id)}\n\nExecution prompt:\n${prompt(task)}`);
  } else {
    throw new Error("Usage: pnpm plan [check|status|next|show PXX]");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

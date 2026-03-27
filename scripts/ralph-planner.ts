import { readFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  type MenuItem,
  box,
  confirm,
  multiSelectMenu,
  palette as c,
  selectMenu,
  statusBadge,
} from "./tui.js";

// ── Constants ────────────────────────────────────────────────────────────────

const COMPLETED_MARKER = "[PLAN HAS BEEN COMPLETED]";
const DONE_AT_MARKER_PREFIX = "[PLAN DONE AT COMMIT ";
const BLOCKED_MARKER = "[BLOCKED]";

// ── Types ────────────────────────────────────────────────────────────────────

type PlanInfo = {
  fileName: string;
  absolutePath: string;
  title: string;
  modifiedAt: Date;
  completed: boolean;
  blocked: boolean;
  doneAtCommit: string | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "just now";
  if (minutes === 1) return "1 min ago";
  if (minutes < 60) return `${minutes} min ago`;
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function planBadge(plan: PlanInfo): string {
  if (plan.completed) return statusBadge.done();
  if (plan.blocked) return statusBadge.blocked();
  return statusBadge.pending();
}

// ── Plan loading ─────────────────────────────────────────────────────────────

async function loadPlans(): Promise<PlanInfo[]> {
  const plansDir = path.resolve(process.cwd(), "plans");
  const entries = await readdir(plansDir, { withFileTypes: true });
  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .sort((a, b) => a.name.localeCompare(b.name));

  return Promise.all(
    markdownFiles.map(async (entry) => {
      const absolutePath = path.join(plansDir, entry.name);
      const content = await readFile(absolutePath, "utf8");
      const fileStat = await stat(absolutePath);

      const firstLine = content.split("\n").find((line) => line.trim().length > 0) ?? "(empty)";
      const title = firstLine.replace(/^#+\s*/, "").trim();

      let doneAtCommit: string | null = null;
      const doneIdx = content.indexOf(DONE_AT_MARKER_PREFIX);
      if (doneIdx !== -1) {
        const start = doneIdx + DONE_AT_MARKER_PREFIX.length;
        const end = content.indexOf("]", start);
        if (end !== -1) doneAtCommit = content.slice(start, end).trim();
      }

      return {
        fileName: entry.name,
        absolutePath,
        title,
        modifiedAt: fileStat.mtime,
        completed: content.includes(COMPLETED_MARKER),
        blocked: content.includes(BLOCKED_MARKER),
        doneAtCommit,
      };
    }),
  );
}

// ── Display ──────────────────────────────────────────────────────────────────

function displayPlans(plans: PlanInfo[]): void {
  const pending = plans.filter((p) => !p.completed);
  const completed = plans.filter((p) => p.completed);

  if (pending.length > 0) {
    const lines = pending.map((plan) => {
      const badge = planBadge(plan);
      return ` ${badge} ${c.bold}${plan.fileName}${c.reset} ${c.dim}${timeAgo(plan.modifiedAt)}${c.reset}  ${c.dim}${plan.title}${c.reset}`;
    });
    console.log(box(`Pending (${pending.length})`, lines));
  }

  if (completed.length > 0) {
    const lines = completed.map((plan) => {
      const badge = planBadge(plan);
      const commitInfo = plan.doneAtCommit ? ` ${c.dim}@ ${plan.doneAtCommit}${c.reset}` : "";
      return ` ${badge} ${c.dim}${plan.fileName}${c.reset}${commitInfo} ${c.dim}${timeAgo(plan.modifiedAt)}${c.reset}  ${c.dim}${plan.title}${c.reset}`;
    });
    console.log(box(`Completed (${completed.length})`, lines));
  }
}

async function deletePlans(plans: PlanInfo[]): Promise<void> {
  if (plans.length === 0) {
    console.log(`\n${c.dim}No plans selected.${c.reset}`);
    return;
  }

  const confirmLines = plans.map(
    (plan) => ` ${c.red}\u2716${c.reset} ${plan.fileName}  ${c.dim}${plan.title}${c.reset}`,
  );
  console.log(box("Will delete", confirmLines));

  const ok = await confirm(`Delete ${plans.length} plan${plans.length > 1 ? "s" : ""}?`);

  if (!ok) {
    console.log(`${c.dim}Cancelled.${c.reset}`);
    return;
  }

  for (const plan of plans) {
    await unlink(plan.absolutePath);
    console.log(`  ${c.red}\u2716${c.reset} ${c.dim}Deleted${c.reset} ${plan.fileName}`);
  }

  console.log(`\n${c.green}${plans.length} plan${plans.length > 1 ? "s" : ""} deleted.${c.reset}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const plans = await loadPlans();

  if (plans.length === 0) {
    console.log(`${c.dim}No plans found in plans/.${c.reset}`);
    return;
  }

  displayPlans(plans);

  const completedPlans = plans.filter((plan) => plan.completed);

  // Action menu
  const actionItems: MenuItem[] = [
    {
      label:
        completedPlans.length > 0
          ? `Delete completed plans (${completedPlans.length})`
          : "Delete completed plans",
      value: "delete-completed",
    },
    { label: "Delete plans...", value: "delete" },
    { label: "Exit", value: "exit" },
  ];

  const action = await selectMenu(actionItems, { title: "Actions", showQuit: false });
  if (action === -1 || actionItems[action].value === "exit") return;

  if (actionItems[action].value === "delete-completed") {
    await deletePlans(completedPlans);
    return;
  }

  // Multi-select for deletion
  const deleteItems: MenuItem[] = plans.map((plan) => ({
    label: `${plan.fileName}  ${c.dim}${plan.title}${c.reset}`,
    value: plan.fileName,
    badge: planBadge(plan),
  }));

  const selected = await multiSelectMenu(deleteItems, {
    title: "Select plans to delete",
    minSelect: 1,
  });
  await deletePlans(selected.map((i) => plans[i]));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error.";
  console.error(`${c.red}${message}${c.reset}`);
  process.exitCode = 1;
});

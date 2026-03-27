import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { type MenuItem, box, confirm, multiSelectMenu, palette as c, statusBadge } from "./tui.js";

// ── Constants ────────────────────────────────────────────────────────────────

const MISSION_LOG_DIR = "out-ralph";
const CURRENT_MISSION_FILE = "current-mission.txt";
const PLANS_DIR = "plans";
const COMPLETED_MARKER = "[PLAN HAS BEEN COMPLETED]";
const BLOCKED_MARKER = "[BLOCKED]";

type PlanOption = {
  relativePath: string;
  exists: boolean;
  inCurrentTail: boolean;
  completed: boolean;
  blocked: boolean;
  lastEditedLabel?: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function currentMissionPath(): string {
  return path.resolve(process.cwd(), MISSION_LOG_DIR, CURRENT_MISSION_FILE);
}

function relativePlanPath(fileName: string): string {
  return path.join(PLANS_DIR, fileName);
}

function normalizeLines(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readCurrentMission(): Promise<string[]> {
  const filePath = currentMissionPath();
  const content = await readFile(filePath, "utf8");
  return normalizeLines(content);
}

async function listAllPlanPaths(): Promise<string[]> {
  const plansDirAbsolute = path.resolve(process.cwd(), PLANS_DIR);
  const entries = await readdir(plansDirAbsolute, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => relativePlanPath(entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function formatRelativeTime(timestampMs: number): string {
  const diffMs = timestampMs - Date.now();
  const absMs = Math.abs(diffMs);

  if (absMs < 60_000) return "just now";

  const units = [
    { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
    { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
    { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
    { unit: "day", ms: 24 * 60 * 60 * 1000 },
    { unit: "hour", ms: 60 * 60 * 1000 },
    { unit: "minute", ms: 60 * 1000 },
  ] as const;

  for (const { unit, ms } of units) {
    if (absMs >= ms) {
      const value = Math.round(diffMs / ms);
      return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(value, unit);
    }
  }

  return "just now";
}

async function buildOptions(
  firstPlan: string,
  currentTail: string[],
  allPlans: string[],
): Promise<PlanOption[]> {
  const optionsOrder = unique([
    ...currentTail.filter((plan) => plan !== firstPlan),
    ...allPlans.filter((plan) => plan !== firstPlan),
  ]);

  return Promise.all(
    optionsOrder.map(async (relativePath) => {
      const absolutePath = path.resolve(process.cwd(), relativePath);
      if (!(await fileExists(absolutePath))) {
        return {
          relativePath,
          exists: false,
          inCurrentTail: currentTail.includes(relativePath),
          completed: false,
          blocked: false,
        } satisfies PlanOption;
      }

      const [stats, content] = await Promise.all([
        stat(absolutePath),
        readFile(absolutePath, "utf8"),
      ]);
      return {
        relativePath,
        exists: true,
        inCurrentTail: currentTail.includes(relativePath),
        completed: content.includes(COMPLETED_MARKER),
        blocked: content.includes(BLOCKED_MARKER),
        lastEditedLabel: formatRelativeTime(stats.mtimeMs),
      } satisfies PlanOption;
    }),
  ).then((options) => options.filter((option) => !option.completed && !option.blocked));
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

async function writeMission(mission: string[]): Promise<void> {
  const outDir = path.resolve(process.cwd(), MISSION_LOG_DIR);
  await mkdir(outDir, { recursive: true });
  const content = mission.join("\n") + "\n";
  await writeFile(currentMissionPath(), content, "utf8");
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const missionPath = currentMissionPath();
  if (!(await fileExists(missionPath))) {
    console.error(
      `${c.red}Missing mission file:${c.reset} ${path.relative(process.cwd(), missionPath)}`,
    );
    process.exitCode = 1;
    return;
  }

  const currentMission = await readCurrentMission();
  if (currentMission.length === 0) {
    console.error(`${c.red}Current mission is empty.${c.reset} Cannot lock first plan.`);
    process.exitCode = 1;
    return;
  }

  const firstPlan = currentMission[0];
  const currentTail = unique(currentMission.slice(1).filter((plan) => plan !== firstPlan));
  const allPlans = await listAllPlanPaths();
  const options = await buildOptions(firstPlan, currentTail, allPlans);

  // Current mission display
  const missionLines = currentMission.map((plan, i) => {
    const tag = i === 0 ? statusBadge.locked() : `${c.dim}[editable]${c.reset}`;
    return ` ${c.bold}${i + 1}.${c.reset} ${plan} ${tag}`;
  });
  console.log(box("Current Mission", missionLines));
  console.log(`${c.dim}Slot 1 is locked (already in progress).${c.reset}\n`);

  if (options.length === 0) {
    console.log(`${c.dim}No other plans available to add.${c.reset}`);
    return;
  }

  // Multi-select for new tail ordering
  const menuItems: MenuItem[] = options.map((opt) => {
    const tags: string[] = [];
    if (opt.inCurrentTail) tags.push(statusBadge.current());
    if (opt.lastEditedLabel) tags.push(`${c.dim}last edited ${opt.lastEditedLabel}${c.reset}`);
    if (opt.exists) tags.push(statusBadge.exists());
    else tags.push(statusBadge.missing());

    return {
      label: opt.relativePath,
      value: opt.relativePath,
      disabled: !opt.exists,
      badge: tags.join(" "),
    };
  });

  const selectedIndices = await multiSelectMenu(menuItems, {
    title: "Select plans for slots 2+",
    ordered: true,
    minSelect: 0,
  });

  const newTail =
    selectedIndices.length === 0 ? [] : selectedIndices.map((i) => options[i].relativePath);

  const updatedMission = [firstPlan, ...newTail];

  // Preview
  const previewLines = updatedMission.map((plan, i) => {
    const tag = i === 0 ? statusBadge.locked() : `${c.dim}[editable]${c.reset}`;
    return ` ${c.bold}${i + 1}.${c.reset} ${plan} ${tag}`;
  });
  console.log(box("Updated Mission Preview", previewLines));

  if (arraysEqual(currentMission, updatedMission)) {
    console.log(`\n${c.dim}No changes detected. Mission file unchanged.${c.reset}`);
    return;
  }

  const ok = await confirm("Write to current-mission.txt?");
  if (!ok) {
    console.log(`${c.dim}Cancelled. Mission file unchanged.${c.reset}`);
    return;
  }

  await writeMission(updatedMission);
  console.log(`\n${c.green}Updated${c.reset} ${path.relative(process.cwd(), missionPath)}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error.";
  console.error(`${c.red}${message}${c.reset}`);
  process.exitCode = 1;
});

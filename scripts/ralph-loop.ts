import { spawn } from "node:child_process";
import { access, appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  type MenuItem,
  box,
  divider,
  multiSelectMenu,
  palette as c,
  selectMenu,
  statusBadge,
} from "./tui.js";

// ── Constants ────────────────────────────────────────────────────────────────

const MARKER = "[PLAN HAS BEEN COMPLETED]";
const DONE_AT_MARKER_PREFIX = "[PLAN DONE AT COMMIT ";
const BLOCKED_MARKER = "[BLOCKED]";
const DEFAULT_MAX_ITERATIONS = 50;
const PRE_PLAN_E2E_PROMPT = `Before doing any of the plans, review the repo guidance on E2E testing and follow it exactly. Do NOT run the full E2E test suite locally. If you need preflight validation before plan work, run only targeted local E2E coverage for the specific area you are about to touch using \`pnpm run test:e2e:base -- tests/e2e/specs/foo.spec.ts\` or the smallest relevant smoke coverage. If you uncover a failure in that targeted coverage, fix the underlying issue before starting plan work. Never run the entire local E2E suite, and never run E2E tests inside the Codex sandbox. Once the relevant targeted preflight coverage is green, stop.`;

const PLAN_PROMPT_PREFIX = `You are implementing the following plan. You must COMPLETE the plan completely to the best of your ability. Prioritize progress each cycle and get as much done as possible in each iteration. Be ambitious: prefer larger, coherent batches of work over tiny safe edits, and try to land multiple related sub-tasks in one pass before handing control back. Because test runs are expensive, do not optimize for minimal diffs or frequent stop points when you can confidently bundle related changes together. If everything is done in the plan, then you should mark the plan as completed — see PLAN COMPLETION below.

BLOCKED DETECTION: Before you start working, review the Iteration Log at the bottom of the plan file (if it exists). If the last 5 or more iterations are stuck on the same issue — repeating the same error, failing in the same way, or making no meaningful progress — then you MUST mark the plan as blocked by writing ${BLOCKED_MARKER} near the top of the markdown file and stop working. Do NOT keep retrying the same failing approach. Only mark as blocked if the iterations show a clear pattern of being stuck; normal incremental progress is fine.

MANDATORY E2E TESTING: Follow the repo E2E guidance exactly. Do NOT run the full E2E suite locally. Implement a substantial chunk of work before re-running tests; prefer validating a cohesive batch of related changes instead of interrupting yourself after every small edit. Run the smallest relevant local E2E coverage for the behavior you changed by forwarding Playwright CLI args to \`pnpm run test:e2e:base -- ...\` when needed (for example \`pnpm run test:e2e:base -- tests/e2e/specs/foo.spec.ts\`). Use \`pnpm test:e2e:smoke\` only when it is the smallest relevant coverage, and note how long each local E2E run took in your iteration notes. Before finalizing an iteration entry in the plan, confirm the relevant targeted E2E coverage passes locally and explicitly note that the full suite must be validated on GitHub Actions rather than by running it locally. Never run E2E tests inside the Codex sandbox.

MANDATORY COMMIT: When meaningful progress is made and smoke tests have passed, you MUST run \`$commit\` in that same iteration before continuing. Commit early and often — do not let good work sit uncommitted. Use meaningful progress as your threshold, not perfect closure.

COMMIT HASH TRACKING: After each \`$commit\`, capture the current commit hash by running \`git rev-parse --short HEAD\`. Record this hash in the Commit column of the Iteration Log entry. If multiple commits are made in a single iteration, record all hashes comma-separated.

PLAN COMPLETION: When the plan is fully done, do the following in order:
1. Run \`$commit\` to commit any remaining work.
2. Capture the final commit hash: \`git rev-parse --short HEAD\`.
3. Write \`${MARKER}\` near the top of the plan markdown file (right after the Status line).
4. On the next line, write \`${DONE_AT_MARKER_PREFIX}<hash>]\` using the commit hash from step 2.
5. Update the Status line to \`## Status: Done\`.

IMPORTANT — Iteration Log:
After you finish working, you MUST append a row to the "## Iteration Log" table at the very bottom of the plan markdown file. If the table does not exist yet, create it. The table format is:

## Iteration Log
| Iteration | Timestamp | Summary | Commit | Errors/Issues |
|-----------|-----------|---------|--------|---------------|

Each row should contain:
- Iteration number (provided below)
- Current UTC timestamp (ISO 8601)
- A brief summary of what you accomplished
- Commit hash(es) from \`git rev-parse --short HEAD\` after each commit (or "—" if no commits this iteration)
- Any errors or issues encountered (or "None")

The plan file is:`;

// ── Types ────────────────────────────────────────────────────────────────────

type CliBackend = "claude" | "codex";

type PlanStatus = {
  absolutePath: string;
  relativePath: string;
  completed: boolean;
  blocked: boolean;
};

class CodexNotFoundError extends Error {
  constructor() {
    super(
      `${c.red}codex CLI not found on PATH.${c.reset} Is it installed? Run ${c.dim}npm i -g @openai/codex${c.reset} to install.`,
    );
    this.name = "CodexNotFoundError";
  }
}

class ClaudeNotFoundError extends Error {
  constructor() {
    super(
      `${c.red}claude CLI not found on PATH.${c.reset} Is it installed? See ${c.dim}https://docs.anthropic.com/en/docs/claude-code${c.reset} for installation.`,
    );
    this.name = "ClaudeNotFoundError";
  }
}

class PlanFileDeletedError extends Error {
  constructor(filePath: string) {
    super(`${c.yellow}Plan file was deleted:${c.reset} ${filePath}`);
    this.name = "PlanFileDeletedError";
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseMaxIterations(argv: string[]): number {
  const idx = argv.indexOf("--max-iterations");
  if (idx === -1) return DEFAULT_MAX_ITERATIONS;
  const raw = argv[idx + 1];
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) {
    console.error(
      `${c.red}Invalid --max-iterations value:${c.reset} ${raw}. Must be a positive integer.`,
    );
    process.exit(1);
  }
  return n;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fileContainsMarker(filePath: string): Promise<boolean> {
  if (!(await fileExists(filePath))) {
    throw new PlanFileDeletedError(filePath);
  }
  const content = await readFile(filePath, "utf8");
  return content.includes(MARKER);
}

function extractDoneAtCommit(content: string): string | null {
  const idx = content.indexOf(DONE_AT_MARKER_PREFIX);
  if (idx === -1) return null;
  const start = idx + DONE_AT_MARKER_PREFIX.length;
  const end = content.indexOf("]", start);
  if (end === -1) return null;
  return content.slice(start, end).trim();
}

async function getDoneAtCommit(filePath: string): Promise<string | null> {
  if (!(await fileExists(filePath))) return null;
  const content = await readFile(filePath, "utf8");
  return extractDoneAtCommit(content);
}

// ── Blocked detection ────────────────────────────────────────────────────────

async function fileContainsBlockedMarker(filePath: string): Promise<boolean> {
  if (!(await fileExists(filePath))) {
    throw new PlanFileDeletedError(filePath);
  }
  const content = await readFile(filePath, "utf8");
  return content.includes(BLOCKED_MARKER);
}

// ── Mission name generator ──────────────────────────────────────────────────

const ADJECTIVES = [
  "fuzzy",
  "happy",
  "cosmic",
  "tiny",
  "brave",
  "sleepy",
  "sparkly",
  "swift",
  "gentle",
  "mighty",
  "cozy",
  "clever",
  "jolly",
  "wild",
  "quiet",
  "golden",
  "bouncy",
  "dizzy",
  "fancy",
  "plucky",
];

const NOUNS = [
  "penguin",
  "otter",
  "bunny",
  "panda",
  "fox",
  "owl",
  "kitten",
  "puppy",
  "hedgehog",
  "duckling",
  "koala",
  "sloth",
  "squirrel",
  "gecko",
  "ferret",
  "hamster",
  "robin",
  "fawn",
  "cub",
  "seal",
];

function generateMissionName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${noun}`;
}

// ── Mission log ─────────────────────────────────────────────────────────────

const MISSION_LOG_DIR = "out-ralph";
const CURRENT_MISSION_FILE = "current-mission.txt";
const CURRENT_LOGS_FILE = "current-logs.txt";
const CURRENT_LOGS_SUMMARY_FILE = "current-logs-summary.txt";
const DIFF_SUMMARY_NOTE = "[git diffs omitted from summary log]";

type SummaryFilterState = {
  inDiff: boolean;
  sawDiffLine: boolean;
  didWriteNotice: boolean;
};

async function createMissionLog(missionName: string, plans: PlanStatus[]): Promise<string> {
  const timestamp = new Date().toISOString();
  const safeTimestamp = timestamp.replace(/:/g, "-").replace(/\./g, "-");
  const fileName = `${safeTimestamp}-${missionName}.md`;
  const dirPath = path.resolve(process.cwd(), MISSION_LOG_DIR);
  const filePath = path.join(dirPath, fileName);

  await mkdir(dirPath, { recursive: true });

  let content = `# Mission: ${missionName}\n\n`;
  content += `**Started:** ${timestamp}\n\n`;
  content += `## Plans\n`;
  for (let i = 0; i < plans.length; i++) {
    content += `${i + 1}. ${plans[i].relativePath}\n`;
  }
  content += `\n`;

  await writeFile(filePath, content, "utf8");
  return filePath;
}

async function appendToMissionLog(filePath: string, text: string): Promise<void> {
  await appendFile(filePath, text, "utf8");
}

// ── Current mission file ────────────────────────────────────────────────────

function currentMissionPath(): string {
  return path.resolve(process.cwd(), MISSION_LOG_DIR, CURRENT_MISSION_FILE);
}

function currentLogsPath(): string {
  return path.resolve(process.cwd(), MISSION_LOG_DIR, CURRENT_LOGS_FILE);
}

function currentLogsSummaryPath(): string {
  return path.resolve(process.cwd(), MISSION_LOG_DIR, CURRENT_LOGS_SUMMARY_FILE);
}

function createSummaryFilterState(): SummaryFilterState {
  return {
    inDiff: false,
    sawDiffLine: false,
    didWriteNotice: false,
  };
}

function isDiffBoundaryLine(line: string): boolean {
  return (
    line.startsWith("diff --git ") ||
    line.startsWith("```diff") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("@@ ") ||
    line === "\\ No newline at end of file"
  );
}

function isDiffHunkLine(line: string): boolean {
  return line.startsWith("+") || line.startsWith("-") || line.startsWith(" ");
}

function filterSummaryLine(
  line: string,
  state: SummaryFilterState,
  summaryStream: NodeJS.WritableStream,
): string | null {
  while (true) {
    if (state.inDiff) {
      if (isDiffBoundaryLine(line)) {
        return null;
      }
      if (state.sawDiffLine && isDiffHunkLine(line)) {
        return null;
      }
      state.inDiff = false;
      state.sawDiffLine = false;
      continue;
    }

    if (isDiffBoundaryLine(line)) {
      if (!state.didWriteNotice) {
        summaryStream.write(`${DIFF_SUMMARY_NOTE}\n`);
        state.didWriteNotice = true;
      }
      state.inDiff = true;
      state.sawDiffLine = true;
      return null;
    }

    return line;
  }
}

function teeStream(
  source: NodeJS.ReadableStream,
  destination: NodeJS.WritableStream,
  fullLogStream: NodeJS.WritableStream,
  summaryLogStream: NodeJS.WritableStream,
  summaryState: SummaryFilterState,
): void {
  let pending = "";

  const flushSummaryLine = (line: string): void => {
    const normalizedLine = line.replace(/\r/g, "");
    const filteredLine = filterSummaryLine(normalizedLine, summaryState, summaryLogStream);
    if (filteredLine !== null) {
      summaryLogStream.write(`${filteredLine}\n`);
    }
  };

  source.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    destination.write(chunk);
    fullLogStream.write(chunk);

    const pieces = (pending + text).split("\n");
    pending = pieces.pop() ?? "";
    for (const piece of pieces) {
      flushSummaryLine(piece);
    }
  });

  source.on("end", () => {
    if (pending.length > 0) {
      flushSummaryLine(pending);
      pending = "";
    }
  });
}

async function writeCurrentMission(plans: PlanStatus[]): Promise<void> {
  const dirPath = path.resolve(process.cwd(), MISSION_LOG_DIR);
  await mkdir(dirPath, { recursive: true });
  const content = plans.map((p) => p.relativePath).join("\n") + "\n";
  await writeFile(currentMissionPath(), content, "utf8");
}

async function readNextPlanFromMission(): Promise<PlanStatus | null> {
  try {
    const content = await readFile(currentMissionPath(), "utf8");
    const lines = content.split("\n").filter((line) => line.trim() !== "");
    if (lines.length === 0) return null;
    const relativePath = lines[0].trim();
    const absolutePath = path.resolve(process.cwd(), relativePath);
    if (!(await fileExists(absolutePath))) return null;
    const fileContent = await readFile(absolutePath, "utf8");
    return {
      absolutePath,
      relativePath,
      completed: fileContent.includes(MARKER),
      blocked: fileContent.includes(BLOCKED_MARKER),
    };
  } catch {
    return null;
  }
}

async function removePlanFromCurrentMission(planRelativePath: string): Promise<void> {
  try {
    const content = await readFile(currentMissionPath(), "utf8");
    const lines = content
      .split("\n")
      .filter((line) => line.trim() !== "" && line.trim() !== planRelativePath);
    await writeFile(currentMissionPath(), lines.length > 0 ? lines.join("\n") + "\n" : "", "utf8");
  } catch {
    // File doesn't exist or can't be read — nothing to remove
  }
}

// ── CLI backend selection ────────────────────────────────────────────────────

async function promptForBackend(): Promise<CliBackend> {
  const items: MenuItem[] = [
    {
      label: "Codex",
      value: "codex",
      description: "gpt-5.4 · high reasoning · --dangerously-bypass-approvals-and-sandbox",
    },
    {
      label: "Claude",
      value: "claude",
      description: "claude-opus-4-6 · --dangerously-skip-permissions",
    },
  ];

  const idx = await selectMenu(items, { title: "Select CLI backend", showQuit: true });
  if (idx === -1) {
    process.exit(0);
  }
  return items[idx].value as CliBackend;
}

// ── Plan listing ─────────────────────────────────────────────────────────────

async function listPlans(): Promise<PlanStatus[]> {
  const plansDir = path.resolve(process.cwd(), "plans");
  const entries = await readdir(plansDir, { withFileTypes: true });
  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const statuses = await Promise.all(
    markdownFiles.map(async (fileName) => {
      const absolutePath = path.join(plansDir, fileName);
      const relativePath = path.join("plans", fileName);
      const content = await readFile(absolutePath, "utf8");
      const completed = content.includes(MARKER);
      const blocked = content.includes(BLOCKED_MARKER);
      return { absolutePath, relativePath, completed, blocked };
    }),
  );

  return statuses;
}

// ── Plan selection ───────────────────────────────────────────────────────────

async function promptForPlans(plans: PlanStatus[]): Promise<PlanStatus[]> {
  const items: MenuItem[] = plans.map((plan) => {
    let badge: string;
    let disabled = false;

    if (plan.completed) {
      badge = statusBadge.done();
      disabled = true;
    } else if (plan.blocked) {
      badge = statusBadge.blocked();
      disabled = true;
    } else {
      badge = statusBadge.pending();
    }

    return {
      label: plan.relativePath,
      value: plan.relativePath,
      disabled,
      badge,
    };
  });

  const allDone = items.every((item) => item.disabled);
  if (allDone) {
    console.log(`${c.green}All plans are already completed or blocked.${c.reset}`);
    return [];
  }

  const selectedIndices = await multiSelectMenu(items, {
    title: "Select plans in execution order",
    ordered: true,
    minSelect: 1,
  });

  if (selectedIndices.length === 0) return [];

  return selectedIndices.map((i) => plans[i]);
}

// ── Codex runner ─────────────────────────────────────────────────────────────

async function runCodexPrompt(prompt: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const logsPath = currentLogsPath();
    const summaryLogsPath = currentLogsSummaryPath();
    const logsStream = createWriteStream(logsPath, { flags: "a" });
    const summaryLogsStream = createWriteStream(summaryLogsPath, { flags: "a" });
    const summaryFilterState = createSummaryFilterState();
    let resolved = false;

    const finalize = (code: number): void => {
      if (resolved) return;
      resolved = true;
      summaryLogsStream.end(() => {
        logsStream.end(() => {
          resolve(code);
        });
      });
    };

    const child = spawn(
      "codex",
      [
        "exec",
        "--dangerously-bypass-approvals-and-sandbox",
        "--model",
        "gpt-5.4",
        "-c",
        'model_reasoning_effort="high"',
        prompt,
      ],
      {
        cwd: process.cwd(),
        stdio: ["inherit", "pipe", "pipe"],
      },
    );

    if (child.stdout) {
      teeStream(child.stdout, process.stdout, logsStream, summaryLogsStream, summaryFilterState);
    }
    if (child.stderr) {
      teeStream(child.stderr, process.stderr, logsStream, summaryLogsStream, summaryFilterState);
    }

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (resolved) return;
      resolved = true;
      summaryLogsStream.end(() => {
        logsStream.end(() => {
          if (err.code === "ENOENT") {
            reject(new CodexNotFoundError());
          } else {
            reject(err);
          }
        });
      });
    });

    child.on("close", (code, signal) => {
      if (signal) {
        finalize(1);
      } else {
        finalize(code ?? 1);
      }
    });
  });
}

async function runCodex(planPath: string, iteration: number): Promise<number> {
  const prompt = `${PLAN_PROMPT_PREFIX}\n${planPath}\n\nThis is iteration ${iteration}.`;
  return runCodexPrompt(prompt);
}

// ── Claude stream-json helpers ───────────────────────────────────────────────

function formatToolUse(block: { name: string; input?: Record<string, unknown> }): string {
  const input = block.input ?? {};
  switch (block.name) {
    case "Bash":
      return `\n[Bash] ${input.command ?? ""}\n`;
    case "Read":
      return `\n[Read] ${input.file_path ?? ""}\n`;
    case "Write":
      return `\n[Write] ${input.file_path ?? ""}\n`;
    case "Edit":
      return `\n[Edit] ${input.file_path ?? ""}\n`;
    case "Glob":
      return `\n[Glob] ${input.pattern ?? ""}\n`;
    case "Grep":
      return `\n[Grep] ${input.pattern ?? ""}\n`;
    default:
      return `\n[${block.name}]\n`;
  }
}

function extractStreamJsonText(line: string): string | null {
  try {
    const event = JSON.parse(line);
    // Assistant message — extract text and tool use info
    if (event.type === "assistant" && event.message?.content) {
      const parts: string[] = [];
      for (const block of event.message.content) {
        if (block.type === "text" && block.text) {
          parts.push(block.text);
        } else if (block.type === "tool_use") {
          parts.push(formatToolUse(block));
        }
      }
      if (parts.length > 0) return parts.join("");
    }
    // Content block delta (streaming text chunks)
    if (event.type === "content_block_delta" && event.delta?.text) {
      return event.delta.text;
    }
    // Tool result — show truncated output
    if (event.type === "tool_result") {
      const content = typeof event.content === "string" ? event.content : "";
      if (content) {
        if (content.length > 1000) {
          const head = content.slice(0, 500);
          const tail = content.slice(-500);
          return `${head}\n… (${content.length} chars total) …\n${tail}\n`;
        }
        return `${content}\n`;
      }
    }
  } catch {
    // Not valid JSON — pass through as raw text
    return line;
  }
  return null;
}

function teeStreamJson(
  source: NodeJS.ReadableStream,
  destination: NodeJS.WritableStream,
  fullLogStream: NodeJS.WritableStream,
  summaryLogStream: NodeJS.WritableStream,
  summaryState: SummaryFilterState,
): void {
  let pending = "";

  const flushSummaryLine = (line: string): void => {
    const normalizedLine = line.replace(/\r/g, "");
    const filteredLine = filterSummaryLine(normalizedLine, summaryState, summaryLogStream);
    if (filteredLine !== null) {
      summaryLogStream.write(`${filteredLine}\n`);
    }
  };

  source.on("data", (chunk) => {
    const raw = chunk.toString("utf8");
    // Always log the raw stream-json to full log
    fullLogStream.write(chunk);

    const lines = (pending + raw).split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() === "") continue;
      const text = extractStreamJsonText(line);
      if (text) {
        destination.write(text);
        flushSummaryLine(text);
      }
    }
  });

  source.on("end", () => {
    if (pending.trim().length > 0) {
      const text = extractStreamJsonText(pending);
      if (text) {
        destination.write(text);
        flushSummaryLine(text);
      }
    }
    pending = "";
  });
}

// ── Claude runner ────────────────────────────────────────────────────────────

async function runClaudePrompt(prompt: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const logsPath = currentLogsPath();
    const summaryLogsPath = currentLogsSummaryPath();
    const logsStream = createWriteStream(logsPath, { flags: "a" });
    const summaryLogsStream = createWriteStream(summaryLogsPath, { flags: "a" });
    const summaryFilterState = createSummaryFilterState();
    let resolved = false;

    const finalize = (code: number): void => {
      if (resolved) return;
      resolved = true;
      summaryLogsStream.end(() => {
        logsStream.end(() => {
          resolve(code);
        });
      });
    };

    // Strip Claude env vars so the child isn't blocked by nested-session detection
    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("CLAUDE")),
    );

    const child = spawn(
      "claude",
      [
        "--dangerously-skip-permissions",
        "--model",
        "claude-opus-4-6",
        "--output-format",
        "stream-json",
        "--verbose",
        "-p",
        prompt,
      ],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "inherit"],
        env: cleanEnv,
      },
    );

    if (child.stdout) {
      teeStreamJson(
        child.stdout,
        process.stdout,
        logsStream,
        summaryLogsStream,
        summaryFilterState,
      );
    }

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (resolved) return;
      resolved = true;
      summaryLogsStream.end(() => {
        logsStream.end(() => {
          if (err.code === "ENOENT") {
            reject(new ClaudeNotFoundError());
          } else {
            reject(err);
          }
        });
      });
    });

    child.on("close", (code, signal) => {
      if (signal) {
        finalize(1);
      } else {
        finalize(code ?? 1);
      }
    });
  });
}

async function runClaude(planPath: string, iteration: number): Promise<number> {
  const prompt = `${PLAN_PROMPT_PREFIX}\n${planPath}\n\nThis is iteration ${iteration}.`;
  return runClaudePrompt(prompt);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const maxIterations = parseMaxIterations(process.argv);

  const backend = await promptForBackend();

  const plans = await listPlans();
  if (plans.length === 0) {
    console.error(`${c.red}No markdown plans found under plans/.${c.reset}`);
    process.exitCode = 1;
    return;
  }

  const selectedPlans = await promptForPlans(plans);
  if (selectedPlans.length === 0) {
    return;
  }

  // Plan order confirmation
  const orderLines = selectedPlans.map(
    (plan, i) => ` ${c.bold}${i + 1}.${c.reset} ${plan.relativePath}`,
  );
  orderLines.push("");
  orderLines.push(` ${c.dim}Max iterations:${c.reset} ${maxIterations}`);
  console.log(box("Plan Order", orderLines));

  const missionName = generateMissionName();
  const missionLogPath = await createMissionLog(missionName, selectedPlans);

  const backendLabel =
    backend === "claude" ? "Claude (claude-opus-4-6)" : "Codex (gpt-5.4, high reasoning)";
  const missionLines = [
    ` ${c.dim}Name:${c.reset}    ${c.purpleBold}${missionName}${c.reset}`,
    ` ${c.dim}Backend:${c.reset} ${backendLabel}`,
    ` ${c.dim}Log:${c.reset}     ${c.dim}${missionLogPath}${c.reset}`,
  ];
  console.log(box("Mission", missionLines));

  await writeCurrentMission(selectedPlans);

  let totalIterationsRun = 0;
  let hadUnfinishedPlan = false;
  let plansCompleted = 0;

  console.log(
    `\n${c.purpleBold}[${missionName}]${c.reset} ${c.bold}Running E2E preflight before plan execution.${c.reset}`,
  );
  const preflightStartTime = Date.now();
  const preflightExitCode =
    backend === "claude"
      ? await runClaudePrompt(PRE_PLAN_E2E_PROMPT)
      : await runCodexPrompt(PRE_PLAN_E2E_PROMPT);
  const preflightElapsed = Date.now() - preflightStartTime;
  const preflightTimeStr = `${c.dim}(${formatDuration(preflightElapsed)})${c.reset}`;
  if (preflightExitCode !== 0) {
    console.error(
      `\n${c.red}${c.bold}[${missionName}] Pre-plan E2E preflight exited with code ${preflightExitCode}.${c.reset} ${preflightTimeStr}`,
    );
    process.exitCode = preflightExitCode;
    return;
  }
  console.log(
    `\n${c.green}[${missionName}] Pre-plan E2E preflight finished${c.reset} ${preflightTimeStr}`,
  );

  while (true) {
    const selectedPlan = await readNextPlanFromMission();
    if (!selectedPlan) break;

    let completed = false;
    let iterationsRun = 0;

    plansCompleted += 1;
    console.log(
      `\n${c.purpleBold}[${missionName}]${c.reset} ${c.bold}Running plan ${plansCompleted}:${c.reset} ${selectedPlan.relativePath}`,
    );
    await appendToMissionLog(
      missionLogPath,
      `---\n\n## ${selectedPlan.relativePath}\n\n| Iteration | Duration | Exit Code |\n|-----------|----------|-----------|\n`,
    );

    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      // Check marker before running
      try {
        if (await fileContainsMarker(selectedPlan.absolutePath)) {
          const doneHash = await getDoneAtCommit(selectedPlan.absolutePath);
          const hashSuffix = doneHash ? ` (commit ${doneHash})` : "";
          console.log(
            `\n${c.bold}${c.green}[${missionName}] Plan already completed${hashSuffix}:${c.reset} ${selectedPlan.relativePath}`,
          );
          await appendToMissionLog(
            missionLogPath,
            `\n**Result:** ALREADY COMPLETE${hashSuffix}\n\n`,
          );
          completed = true;
          break;
        }
      } catch (err) {
        if (err instanceof PlanFileDeletedError) {
          console.error(`\n${err.message} Stopping.`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }

      // Iteration header
      console.log(
        `\n${divider(undefined, `${missionName} \u00b7 Iteration ${iteration}/${maxIterations}`)}`,
      );
      console.log(`${c.dim}${selectedPlan.relativePath}${c.reset}\n`);

      const startTime = Date.now();
      iterationsRun += 1;
      totalIterationsRun += 1;
      const exitCode =
        backend === "claude"
          ? await runClaude(selectedPlan.relativePath, iteration)
          : await runCodex(selectedPlan.relativePath, iteration);
      const elapsed = Date.now() - startTime;

      // Iteration footer
      const timeStr = `${c.dim}(${formatDuration(elapsed)})${c.reset}`;
      if (exitCode !== 0) {
        console.log(
          `\n${c.yellow}Iteration ${iteration} exited with code ${exitCode}${c.reset} ${timeStr}`,
        );
      } else {
        console.log(`\n${c.green}Iteration ${iteration} finished${c.reset} ${timeStr}`);
      }

      await appendToMissionLog(
        missionLogPath,
        `| ${iteration} | ${formatDuration(elapsed)} | ${exitCode} |\n`,
      );

      // Check marker after running
      try {
        if (await fileContainsMarker(selectedPlan.absolutePath)) {
          const doneHash = await getDoneAtCommit(selectedPlan.absolutePath);
          const hashSuffix = doneHash ? ` at commit ${doneHash}` : "";
          console.log(
            `\n${c.bold}${c.green}[${missionName}] Plan completed after ${iteration} iteration${iteration > 1 ? "s" : ""}${hashSuffix}!${c.reset} ${selectedPlan.relativePath}`,
          );
          await appendToMissionLog(
            missionLogPath,
            `\n**Result:** COMPLETE (${iteration} iteration${iteration > 1 ? "s" : ""}${hashSuffix})\n\n`,
          );
          completed = true;
          break;
        }
      } catch (err) {
        if (err instanceof PlanFileDeletedError) {
          console.error(`\n${err.message} Stopping.`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }

      // Check if LLM marked the plan as blocked
      try {
        if (await fileContainsBlockedMarker(selectedPlan.absolutePath)) {
          console.log(
            `\n${c.red}${c.bold}[${missionName}] Plan blocked after ${iteration} iteration${iteration > 1 ? "s" : ""} — repeated failures detected.${c.reset} ${selectedPlan.relativePath}`,
          );
          await appendToMissionLog(
            missionLogPath,
            `\n**Result:** BLOCKED (${iteration} iteration${iteration > 1 ? "s" : ""})\n\n`,
          );
          hadUnfinishedPlan = true;
          break;
        }
      } catch (err) {
        if (err instanceof PlanFileDeletedError) {
          console.error(`\n${err.message} Stopping.`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    }

    if (!completed && iterationsRun === maxIterations) {
      // Exhausted iterations
      console.log(
        `\n${c.red}${c.bold}[${missionName}] Reached max iterations (${maxIterations}) without completing the plan.${c.reset}`,
      );
      console.log(`${c.dim}Run again with --max-iterations <n> to increase the limit.${c.reset}`);
      await appendToMissionLog(
        missionLogPath,
        `\n**Result:** MAX ITERATIONS (${maxIterations})\n\n`,
      );
      hadUnfinishedPlan = true;
    }

    console.log(
      `\n${c.purpleBold}[${missionName}]${c.reset} ${c.bold}Plan loop finished after ${iterationsRun} iteration${iterationsRun > 1 ? "s" : ""}.${c.reset}`,
    );

    await removePlanFromCurrentMission(selectedPlan.relativePath);
  }

  if (hadUnfinishedPlan) {
    process.exitCode = 1;
  }

  const endTime = new Date().toISOString();
  await appendToMissionLog(
    missionLogPath,
    `---\n\n**Mission finished:** ${endTime}\n**Total iterations:** ${totalIterationsRun}\n`,
  );

  console.log(
    `\n${c.purpleBold}[${missionName}]${c.reset} ${c.bold}All plans finished after ${totalIterationsRun} total iteration${totalIterationsRun > 1 ? "s" : ""}.${c.reset}`,
  );
  console.log(`${c.dim}Mission log: ${missionLogPath}${c.reset}`);
}

main().catch((error) => {
  if (
    error instanceof CodexNotFoundError ||
    error instanceof ClaudeNotFoundError ||
    error instanceof PlanFileDeletedError
  ) {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
    return;
  }
  const message = error instanceof Error ? error.message : "Unknown failure running plan loop.";
  console.error(`${c.red}${message}${c.reset}`);
  process.exitCode = 1;
});

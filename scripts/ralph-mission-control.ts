import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  type MenuItem,
  box,
  palette as c,
  selectMenu,
  showContent,
  statusBadge,
  termWidth,
} from "./tui.js";

// ── Constants ────────────────────────────────────────────────────────────────

const MISSION_LOG_DIR = "out-ralph";
const CURRENT_MISSION_FILE = "current-mission.txt";
const PLANS_DIR = "plans";

type ReportFile = {
  fileName: string;
  absolutePath: string;
  modifiedAt: Date;
};

type MarkdownTable = {
  header: string[];
  rows: string[][];
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function currentMissionPath(): string {
  return path.resolve(process.cwd(), MISSION_LOG_DIR, CURRENT_MISSION_FILE);
}

async function getLatestFile(dir: string): Promise<ReportFile | null> {
  const dirPath = path.resolve(process.cwd(), dir);
  if (!(await fileExists(dirPath))) return null;

  const entries = await readdir(dirPath, { withFileTypes: true });
  const mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".md"));
  if (mdFiles.length === 0) return null;

  const files = await Promise.all(
    mdFiles.map(async (e) => {
      const abs = path.join(dirPath, e.name);
      const s = await stat(abs);
      return { fileName: e.name, absolutePath: abs, modifiedAt: s.mtime } satisfies ReportFile;
    }),
  );

  files.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  return files[0];
}

function isMarkdownTableLine(line: string): boolean {
  return line.includes("|");
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = splitMarkdownRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitMarkdownRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function wrapWords(text: string, width: number): string[] {
  if (text.length === 0) return [""];
  if (width <= 1) return text.split("");

  const words = text.match(/\S+/g) ?? [];
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (current.length === 0) {
      if (word.length <= width) {
        current = word;
        continue;
      }
      for (let i = 0; i < word.length; i += width) {
        lines.push(word.slice(i, i + width));
      }
      continue;
    }

    if (current.length + 1 + word.length <= width) {
      current += ` ${word}`;
      continue;
    }

    lines.push(current);
    if (word.length <= width) {
      current = word;
      continue;
    }

    for (let i = 0; i < word.length; i += width) {
      const chunk = word.slice(i, i + width);
      if (i + width >= word.length) {
        current = chunk;
      } else {
        lines.push(chunk);
      }
    }
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [""];
}

function fitColumnWidths(rows: string[][], maxWidth: number): number[] {
  const columnCount = Math.max(...rows.map((row) => row.length));
  const natural = Array.from({ length: columnCount }, (_, column) =>
    Math.max(
      ...rows.map((row) => {
        const cell = row[column] ?? "";
        return Math.max(...wrapWords(cell, Math.max(cell.length, 1)).map((part) => part.length));
      }),
      3,
    ),
  );
  const minimum = natural.map(() => 1);
  const borderWidth = columnCount * 3 + 1;
  let widths = [...natural];
  let total = widths.reduce((sum, value) => sum + value, 0) + borderWidth;

  while (total > maxWidth) {
    let changed = false;
    for (let i = 0; i < widths.length && total > maxWidth; i += 1) {
      if (widths[i] > minimum[i]) {
        widths[i] -= 1;
        total -= 1;
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  return widths;
}

function tableNaturalWidth(rows: string[][]): number {
  const columnCount = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: columnCount }, (_, column) =>
    Math.max(
      ...rows.map((row) => {
        const cell = row[column] ?? "";
        return Math.max(cell.length, 3);
      }),
      3,
    ),
  );
  return widths.reduce((sum, value) => sum + value, 0) + columnCount * 3 + 1;
}

function renderStackedMarkdownTable(table: MarkdownTable): string[] {
  return table.rows.flatMap((row, rowIndex) => {
    const lines = [`[Row ${rowIndex + 1}]`];
    for (let i = 0; i < table.header.length; i += 1) {
      const label = table.header[i] ?? `Column ${i + 1}`;
      const value = row[i] ?? "";
      if (value.length === 0) {
        lines.push(`${label}:`);
        continue;
      }
      lines.push(`${label}: ${value}`);
    }
    if (rowIndex < table.rows.length - 1) {
      lines.push("");
    }
    return lines;
  });
}

function shouldRenderStackedTable(table: MarkdownTable): boolean {
  const rows = [table.header, ...table.rows];
  const availableWidth = Math.max(termWidth() - 6, 10);
  const columnCount = Math.max(...rows.map((row) => row.length));
  const longestCell = Math.max(...rows.flatMap((row) => row.map((cell) => cell.length)), 0);
  return (
    tableNaturalWidth(rows) > availableWidth ||
    (columnCount >= 4 && longestCell > 40) ||
    (columnCount >= 3 && longestCell > 72)
  );
}

function renderMarkdownTable(table: MarkdownTable): string[] {
  if (shouldRenderStackedTable(table)) {
    return renderStackedMarkdownTable(table);
  }

  const rows = [table.header, ...table.rows];
  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? ""),
  );
  const maxWidth = Math.max(termWidth() - 6, 10);
  const widths = fitColumnWidths(normalizedRows, maxWidth);

  const border = (left: string, mid: string, right: string): string =>
    `${left}${widths.map((width) => "─".repeat(width + 2)).join(mid)}${right}`;

  const renderRow = (row: string[]): string[] => {
    const wrapped = row.map((cell, index) => wrapWords(cell, widths[index] ?? 6));
    const height = Math.max(...wrapped.map((lines) => lines.length), 1);
    return Array.from({ length: height }, (_, lineIndex) => {
      const cells = wrapped.map((lines, columnIndex) => {
        const text = lines[lineIndex] ?? "";
        return ` ${(text ?? "").padEnd(widths[columnIndex] ?? 6)} `;
      });
      return `│${cells.join("│")}│`;
    });
  };

  return [
    border("┌", "┬", "┐"),
    ...renderRow(normalizedRows[0] ?? []),
    border("├", "┼", "┤"),
    ...normalizedRows.slice(1).flatMap(renderRow),
    border("└", "┴", "┘"),
  ];
}

function extractMarkdownTable(
  lines: string[],
  start: number,
): { table: MarkdownTable; nextIndex: number } {
  const header = splitMarkdownRow(lines[start] ?? "");
  const rows: string[][] = [];
  let index = start + 2;

  while (index < lines.length && isMarkdownTableLine(lines[index] ?? "")) {
    rows.push(splitMarkdownRow(lines[index] ?? ""));
    index += 1;
  }

  return {
    table: { header, rows },
    nextIndex: index,
  };
}

function formatMarkdownForTerminal(content: string): string {
  const lines = content.split("\n");
  const output: string[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; ) {
    const line = lines[i] ?? "";

    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      output.push(line);
      i += 1;
      continue;
    }

    if (
      !inFence &&
      i + 1 < lines.length &&
      isMarkdownTableLine(line) &&
      isMarkdownTableSeparator(lines[i + 1] ?? "")
    ) {
      const { table, nextIndex } = extractMarkdownTable(lines, i);
      output.push(...renderMarkdownTable(table));
      i = nextIndex;
      continue;
    }

    output.push(line);
    i += 1;
  }

  return output.join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  while (true) {
    const latest = await getLatestFile(MISSION_LOG_DIR);
    const latestPlan = await getLatestFile(PLANS_DIR);
    const missionExists = await fileExists(currentMissionPath());

    // Status panel
    const statusLines: string[] = [
      ` ${c.dim}Mission file${c.reset}   ${missionExists ? `${c.green}${CURRENT_MISSION_FILE}${c.reset}` : `${c.red}not found${c.reset}`}`,
      ` ${c.dim}Latest report${c.reset}  ${latest ? `${latest.fileName} ${c.dim}(${timeAgo(latest.modifiedAt)})${c.reset}` : `${c.dim}none${c.reset}`}`,
      ` ${c.dim}Latest plan${c.reset}    ${latestPlan ? `${latestPlan.fileName} ${c.dim}(${timeAgo(latestPlan.modifiedAt)})${c.reset}` : `${c.dim}none${c.reset}`}`,
    ];
    console.log(box("Status", statusLines));

    // Build menu items
    const items: MenuItem[] = [
      {
        label: "View current mission",
        value: "mission",
        disabled: !missionExists,
        badge: missionExists ? undefined : statusBadge.missing(),
      },
      {
        label: `View latest report${latest ? ` (${latest.fileName})` : ""}`,
        value: "report",
        disabled: !latest,
        badge: latest ? undefined : statusBadge.missing(),
      },
      {
        label: `View latest plan${latestPlan ? ` (${latestPlan.fileName})` : ""}`,
        value: "plan",
        disabled: !latestPlan,
        badge: latestPlan ? undefined : statusBadge.missing(),
      },
    ];

    const selected = await selectMenu(items, { title: "Mission Control" });

    if (selected === -1) return;

    if (selected === 0) {
      const content = await readFile(currentMissionPath(), "utf8");
      await showContent(CURRENT_MISSION_FILE, content);
    } else if (selected === 1 && latest) {
      const content = await readFile(latest.absolutePath, "utf8");
      await showContent(latest.fileName, formatMarkdownForTerminal(content));
    } else if (selected === 2 && latestPlan) {
      const content = await readFile(latestPlan.absolutePath, "utf8");
      await showContent(latestPlan.fileName, formatMarkdownForTerminal(content));
    }

    console.log(); // spacing before next loop
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error.";
  console.error(`${c.red}${message}${c.reset}`);
  process.exitCode = 1;
});

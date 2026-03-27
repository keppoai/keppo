import process from "node:process";
import { createInterface } from "node:readline/promises";

// ── Color palette ───────────────────────────────────────────────────────────

export const palette = {
  // Primary accent: purple/magenta
  magenta: "\x1b[35m",
  magentaBold: "\x1b[1;35m",
  purple: "\x1b[38;5;141m",
  purpleBold: "\x1b[1;38;5;141m",

  // Status colors
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",

  // Modifiers
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
} as const;

// Aliases for readability
const p = palette;

// ── ANSI helpers ────────────────────────────────────────────────────────────

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

export function termWidth(): number {
  return process.stdout.columns ?? 80;
}

function termHeight(): number {
  return process.stdout.rows ?? 24;
}

function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

function wrapLongWord(word: string, width: number): string[] {
  if (width <= 0) return [word];
  const chunks: string[] = [];
  for (let i = 0; i < word.length; i += width) {
    chunks.push(word.slice(i, i + width));
  }
  return chunks;
}

function wrapTextWithPrefix(
  text: string,
  width: number,
  firstPrefix: string,
  continuationPrefix: string,
): string[] {
  const firstWidth = Math.max(width - visibleLength(firstPrefix), 1);
  const continuationWidth = Math.max(width - visibleLength(continuationPrefix), 1);

  if (text.length === 0) {
    return [firstPrefix];
  }

  const lines: string[] = [];
  let currentPrefix = firstPrefix;
  let currentWidth = firstWidth;
  let currentLine = "";

  const pushLine = (): void => {
    lines.push(currentPrefix + currentLine);
    currentPrefix = continuationPrefix;
    currentWidth = continuationWidth;
    currentLine = "";
  };

  const words = text.match(/\S+/g) ?? [];
  for (const word of words) {
    if (currentLine.length === 0) {
      if (word.length <= currentWidth) {
        currentLine = word;
        continue;
      }
      const chunks = wrapLongWord(word, currentWidth);
      currentLine = chunks[0] ?? "";
      pushLine();
      for (let i = 1; i < chunks.length; i += 1) {
        currentLine = chunks[i] ?? "";
        if (i < chunks.length - 1) {
          pushLine();
        }
      }
      continue;
    }

    if (currentLine.length + 1 + word.length <= currentWidth) {
      currentLine += ` ${word}`;
      continue;
    }

    pushLine();
    if (word.length <= currentWidth) {
      currentLine = word;
      continue;
    }

    const chunks = wrapLongWord(word, currentWidth);
    currentLine = chunks[0] ?? "";
    pushLine();
    for (let i = 1; i < chunks.length; i += 1) {
      currentLine = chunks[i] ?? "";
      if (i < chunks.length - 1) {
        pushLine();
      }
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentPrefix + currentLine);
  }

  return lines.length > 0 ? lines : [firstPrefix];
}

function padOrTruncate(text: string, width: number): string {
  const visible = visibleLength(text);
  if (visible <= width) {
    return text + " ".repeat(width - visible);
  }
  // Truncate — walk the string keeping ANSI codes but counting visible chars
  let count = 0;
  let result = "";
  let i = 0;
  const raw = text;
  while (i < raw.length && count < width - 1) {
    if (raw[i] === "\x1b") {
      const match = raw.slice(i).match(/^\x1b\[[0-9;]*m/);
      if (match) {
        result += match[0];
        i += match[0].length;
        continue;
      }
    }
    result += raw[i];
    count += 1;
    i += 1;
  }
  return result + "\u2026" + p.reset;
}

// ── Box-drawing ─────────────────────────────────────────────────────────────

const BOX = {
  tl: "\u250c", // ┌
  tr: "\u2510", // ┐
  bl: "\u2514", // └
  br: "\u2518", // ┘
  h: "\u2500", // ─
  v: "\u2502", // │
  ml: "\u251c", // ├
  mr: "\u2524", // ┤
} as const;

export function box(title: string, lines: string[], width?: number): string {
  const w = Math.max(width ?? termWidth(), 20);
  const inner = w - 2;
  const border = p.purple;
  const r = p.reset;

  // Top border with optional title
  let top: string;
  if (title) {
    const cleanTitle = stripAnsi(title);
    const titlePart = ` ${title} `;
    const titleLen = cleanTitle.length + 2; // spaces around title
    const remaining = Math.max(inner - titleLen - 1, 0);
    top = `${border}${BOX.tl}${BOX.h}${r}${p.purpleBold}${titlePart}${r}${border}${BOX.h.repeat(remaining)}${BOX.tr}${r}`;
  } else {
    top = `${border}${BOX.tl}${BOX.h.repeat(inner)}${BOX.tr}${r}`;
  }

  // Content lines
  const body = lines.map((line) => {
    const padded = padOrTruncate(line, inner);
    return `${border}${BOX.v}${r}${padded}${border}${BOX.v}${r}`;
  });

  // Bottom border
  const bottom = `${border}${BOX.bl}${BOX.h.repeat(inner)}${BOX.br}${r}`;

  return [top, ...body, bottom].join("\n");
}

export function divider(width?: number, label?: string): string {
  const w = Math.max(width ?? termWidth(), 20);
  const inner = w - 2;
  const border = p.purple;
  const r = p.reset;

  if (label) {
    const cleanLabel = stripAnsi(label);
    const labelPart = ` ${label} `;
    const labelLen = cleanLabel.length + 2;
    const remaining = Math.max(inner - labelLen - 1, 0);
    return `${border}${BOX.ml}${BOX.h}${r}${p.dim}${labelPart}${r}${border}${BOX.h.repeat(remaining)}${BOX.mr}${r}`;
  }

  return `${border}${BOX.ml}${BOX.h.repeat(inner)}${BOX.mr}${r}`;
}

export function header(text: string): string {
  const w = Math.max(termWidth(), 20);
  const inner = w - 2;
  const cleanText = stripAnsi(text);
  const padLeft = Math.max(Math.floor((inner - cleanText.length) / 2), 0);
  const padRight = Math.max(inner - cleanText.length - padLeft, 0);
  const border = p.purple;
  const r = p.reset;

  const top = `${border}${BOX.tl}${BOX.h.repeat(inner)}${BOX.tr}${r}`;
  const mid = `${border}${BOX.v}${r}${" ".repeat(padLeft)}${p.purpleBold}${text}${r}${" ".repeat(padRight)}${border}${BOX.v}${r}`;
  const bot = `${border}${BOX.bl}${BOX.h.repeat(inner)}${BOX.br}${r}`;

  return [top, mid, bot].join("\n");
}

// ── Status badges ───────────────────────────────────────────────────────────

function badge(text: string, color: string): string {
  return `${color}[${text}]${p.reset}`;
}

export const statusBadge = {
  done: () => badge("done", p.green),
  blocked: () => badge("blocked", p.red),
  pending: () => badge("pending", p.yellow),
  wait: () => badge("wait", p.yellow),
  locked: () => badge("locked", p.yellow),
  current: () => badge("current", p.yellow),
  new: () => badge("new", p.dim),
  missing: () => badge("missing", p.red),
  exists: () => badge("exists", p.green),
} as const;

// ── Content viewer ──────────────────────────────────────────────────────────

export type ContentViewerOptions = {
  maxLines?: number;
  showLineNumbers?: boolean;
};

export async function showContent(
  title: string,
  content: string,
  options?: ContentViewerOptions,
): Promise<void> {
  const allLines = content.split("\n");
  // Remove trailing empty line if file ends with newline
  if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
    allLines.pop();
  }

  const formatLines = (): string[] => {
    const contentWidth = Math.max(termWidth() - 2, 18);
    if (options?.showLineNumbers) {
      const numWidth = String(allLines.length).length;
      return allLines.flatMap((line, i) => {
        const num = String(i + 1).padStart(numWidth);
        return wrapTextWithPrefix(
          line,
          contentWidth,
          ` ${p.dim}${num}${p.reset} `,
          ` ${" ".repeat(numWidth)} `,
        );
      });
    }

    return allLines.flatMap((line) => wrapTextWithPrefix(line, contentWidth, " ", " "));
  };

  let formatted = formatLines();

  // Non-interactive mode keeps a bounded view to avoid dumping huge files.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const max = options?.maxLines ?? Math.max(termHeight() - 8, 10);
    const truncated = formatted.length > max;
    const displayLines = truncated ? formatted.slice(0, max) : formatted;
    if (truncated) {
      displayLines.push("");
      displayLines.push(` ${p.dim}showing ${max} of ${formatted.length} lines${p.reset}`);
    }
    console.log(box(title, displayLines));
    return;
  }

  const footerHeight = 5;
  let offset = 0;
  let renderedLines = 0;
  let cleanedUp = false;

  const pageSize = (): number => Math.max(termHeight() - footerHeight, 5);

  const maxOffset = (): number => Math.max(formatted.length - pageSize(), 0);

  const render = (): void => {
    if (renderedLines > 0) {
      clearLines(renderedLines);
    }

    formatted = formatLines();

    const currentPageSize = pageSize();
    const visible = formatted.slice(offset, offset + currentPageSize);
    const percent =
      formatted.length === 0
        ? 100
        : Math.min(100, Math.round(((offset + visible.length) / formatted.length) * 100));
    const footer = [
      ` ${p.dim}Lines ${visible.length === 0 ? 0 : offset + 1}-${offset + visible.length} of ${formatted.length}${p.reset}`,
      ` ${p.dim}Progress ${percent}%${p.reset}`,
      ` ${p.dim}Controls: ↑/↓ scroll  PgUp/PgDn page  g/G top/bottom  q, Enter, Esc close${p.reset}`,
    ];
    const output = box(title, [...visible, "", ...footer]);
    process.stdout.write(`${output}\n`);
    renderedLines = output.split("\n").length + 1;
  };

  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    process.stdin.removeListener("data", onData);
    process.stdout.removeListener("resize", onResize);
    process.stdin.setRawMode(wasRaw ?? false);
    if (!wasRaw) {
      process.stdin.pause();
    }
    showCursor();
  };

  const clampOffset = (): void => {
    offset = Math.max(0, Math.min(offset, maxOffset()));
  };

  const onResize = (): void => {
    clampOffset();
    render();
  };

  let resolveViewer!: () => void;

  const onData = (data: string): void => {
    switch (data) {
      case "\u0003":
      case "q":
      case "Q":
      case "\r":
      case "\n":
      case "\u001b":
        cleanup();
        if (data === "\u0003") {
          process.exitCode = 130;
        }
        process.stdout.write("\n");
        resolveViewer();
        return;
      case "g":
        offset = 0;
        render();
        return;
      case "G":
        offset = maxOffset();
        render();
        return;
      case "j":
      case "\u001b[B":
        offset += 1;
        clampOffset();
        render();
        return;
      case "k":
      case "\u001b[A":
        offset -= 1;
        clampOffset();
        render();
        return;
      case " ":
      case "\u001b[6~":
        offset += pageSize();
        clampOffset();
        render();
        return;
      case "b":
      case "\u001b[5~":
        offset -= pageSize();
        clampOffset();
        render();
        return;
      default:
        return;
    }
  };

  const wasRaw = process.stdin.isRaw;
  hideCursor();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", onData);
  process.stdout.on("resize", onResize);
  render();

  await new Promise<void>((resolve) => {
    resolveViewer = resolve;
  });
}

// ── Confirm prompt ──────────────────────────────────────────────────────────

export async function confirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await rl.question(`${message} ${p.dim}(y/N)${p.reset} `);
      return answer.trim().toLowerCase() === "y";
    } finally {
      rl.close();
    }
  }

  process.stdout.write(`${message} ${p.dim}(y/N)${p.reset} `);

  return new Promise<boolean>((resolve) => {
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const cleanup = (): void => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(wasRaw ?? false);
      process.stdin.pause();
    };

    const onData = (data: string): void => {
      cleanup();
      const ch = data[0]?.toLowerCase();
      if (ch === "y") {
        process.stdout.write(`${p.green}yes${p.reset}\n`);
        resolve(true);
      } else {
        process.stdout.write(`${p.dim}no${p.reset}\n`);
        resolve(false);
      }
    };

    process.stdin.on("data", onData);
  });
}

// ── Menu types ──────────────────────────────────────────────────────────────

export type MenuItem = {
  label: string;
  value: string;
  disabled?: boolean;
  badge?: string;
  description?: string;
};

export type SelectMenuOptions = {
  title?: string;
  showQuit?: boolean;
  pageSize?: number;
};

export type MultiSelectOptions = {
  title?: string;
  showQuit?: boolean;
  pageSize?: number;
  ordered?: boolean;
  minSelect?: number;
};

// ── Raw-mode menu internals ─────────────────────────────────────────────────

function hideCursor(): void {
  process.stdout.write("\x1b[?25l");
}

function showCursor(): void {
  process.stdout.write("\x1b[?25h");
}

function clearLines(count: number): void {
  // After writing N lines + trailing \n, cursor is 1 line below last output.
  // Move up count lines to reach the first output line, then clear everything below.
  if (count > 0) {
    process.stdout.write(`\x1b[${count}A`);
  }
  process.stdout.write("\x1b[J"); // clear from cursor to end of screen
}

function nextSelectable(items: MenuItem[], from: number, direction: 1 | -1): number {
  let idx = from + direction;
  while (idx >= 0 && idx < items.length) {
    if (!items[idx].disabled) return idx;
    idx += direction;
  }
  return from; // no valid move
}

function firstSelectable(items: MenuItem[]): number {
  for (let i = 0; i < items.length; i++) {
    if (!items[i].disabled) return i;
  }
  return -1;
}

// ── Single-select menu ──────────────────────────────────────────────────────

export async function selectMenu(items: MenuItem[], options?: SelectMenuOptions): Promise<number> {
  if (items.length === 0) return -1;

  const first = firstSelectable(items);
  if (first === -1) return -1;

  // Non-TTY fallback
  if (!process.stdin.isTTY) {
    return fallbackNumberSelect(items, options);
  }

  const showQuit = options?.showQuit ?? true;
  const pageSize = options?.pageSize ?? 15;
  const title = options?.title;

  let cursor = first;
  let scrollOffset = 0;
  let renderedLines = 0;

  const render = (): void => {
    if (renderedLines > 0) {
      clearLines(renderedLines);
    }

    const output: string[] = [];

    // Scroll window
    const visibleCount = Math.min(pageSize, items.length);
    if (cursor < scrollOffset) scrollOffset = cursor;
    if (cursor >= scrollOffset + visibleCount) scrollOffset = cursor - visibleCount + 1;

    const hasAbove = scrollOffset > 0;
    const hasBelow = scrollOffset + visibleCount < items.length;

    if (hasAbove) {
      output.push(`  ${p.dim}\u2191 ${scrollOffset} more above${p.reset}`);
    }

    for (let i = scrollOffset; i < scrollOffset + visibleCount && i < items.length; i++) {
      const item = items[i];
      const isSelected = i === cursor;

      if (item.disabled) {
        const badgeStr = item.badge ? ` ${item.badge}` : "";
        output.push(`    ${p.dim}${item.label}${badgeStr}${p.reset}`);
      } else if (isSelected) {
        const badgeStr = item.badge ? ` ${item.badge}` : "";
        output.push(
          `  ${p.magentaBold}\u276f${p.reset} ${p.bold}${item.label}${p.reset}${badgeStr}`,
        );
      } else {
        const badgeStr = item.badge ? ` ${item.badge}` : "";
        output.push(`    ${item.label}${badgeStr}`);
      }

      if (item.description && isSelected) {
        output.push(`      ${p.dim}${item.description}${p.reset}`);
      }
    }

    if (hasBelow) {
      output.push(
        `  ${p.dim}\u2193 ${items.length - scrollOffset - visibleCount} more below${p.reset}`,
      );
    }

    // Hints
    const hints = [`${p.dim}\u2191\u2193 move`, `enter select`];
    if (showQuit) hints.push(`q quit`);
    output.push(`  ${hints.join(`${p.reset}${p.dim}  \u00b7  `)}${p.reset}`);

    const text = output.join("\n") + "\n";
    process.stdout.write(text);
    renderedLines = output.length;
  };

  return new Promise<number>((resolve) => {
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const cleanup = (): void => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(wasRaw ?? false);
      process.stdin.pause();
      showCursor();
    };

    const exitHandler = (): void => {
      showCursor();
    };
    process.on("exit", exitHandler);

    const onData = (data: string): void => {
      if (data === "\x1b[A" || data === "k") {
        cursor = nextSelectable(items, cursor, -1);
        render();
      } else if (data === "\x1b[B" || data === "j") {
        cursor = nextSelectable(items, cursor, 1);
        render();
      } else if (data === "\r") {
        cleanup();
        process.removeListener("exit", exitHandler);
        resolve(cursor);
      } else if (data === "q" && showQuit) {
        cleanup();
        process.removeListener("exit", exitHandler);
        resolve(-1);
      } else if (data === "\x03") {
        cleanup();
        process.removeListener("exit", exitHandler);
        process.exit(0);
      }
    };

    // Title
    if (title) {
      console.log(header(title));
    }

    hideCursor();
    render();

    process.stdin.on("data", onData);
  });
}

async function fallbackNumberSelect(
  items: MenuItem[],
  options?: SelectMenuOptions,
): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (options?.title) {
      console.log(`\n${p.purpleBold}${options.title}${p.reset}\n`);
    }

    let num = 1;
    const indexMap = new Map<number, number>();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.disabled) {
        const badgeStr = item.badge ? ` ${item.badge}` : "";
        console.log(`  ${p.dim}- ${item.label}${badgeStr}${p.reset}`);
      } else {
        const badgeStr = item.badge ? ` ${item.badge}` : "";
        console.log(`  ${p.bold}${num}.${p.reset} ${item.label}${badgeStr}`);
        indexMap.set(num, i);
        num += 1;
      }
    }

    const showQuit = options?.showQuit ?? true;
    if (showQuit) console.log(`  q) Quit`);
    console.log();

    while (true) {
      const answer = (await rl.question(`${p.magenta}\u276f${p.reset} `)).trim().toLowerCase();
      if ((answer === "q" || answer === "quit") && showQuit) return -1;

      const n = Number.parseInt(answer, 10);
      const mapped = indexMap.get(n);
      if (mapped !== undefined) return mapped;

      console.log(`${p.red}Invalid selection.${p.reset}`);
    }
  } finally {
    rl.close();
  }
}

// ── Multi-select menu ───────────────────────────────────────────────────────

export async function multiSelectMenu(
  items: MenuItem[],
  options?: MultiSelectOptions,
): Promise<number[]> {
  if (items.length === 0) return [];

  const first = firstSelectable(items);
  if (first === -1) return [];

  // Non-TTY fallback
  if (!process.stdin.isTTY) {
    return fallbackMultiSelect(items, options);
  }

  const showQuit = options?.showQuit ?? true;
  const pageSize = options?.pageSize ?? 15;
  const ordered = options?.ordered ?? false;
  const minSelect = options?.minSelect ?? 0;
  const title = options?.title;

  let cursor = first;
  let scrollOffset = 0;
  let renderedLines = 0;
  const selections: number[] = []; // indices into items, in selection order
  let flashMessage = "";

  const render = (): void => {
    if (renderedLines > 0) {
      clearLines(renderedLines);
    }

    const output: string[] = [];

    const visibleCount = Math.min(pageSize, items.length);
    if (cursor < scrollOffset) scrollOffset = cursor;
    if (cursor >= scrollOffset + visibleCount) scrollOffset = cursor - visibleCount + 1;

    const hasAbove = scrollOffset > 0;
    const hasBelow = scrollOffset + visibleCount < items.length;

    if (hasAbove) {
      output.push(`  ${p.dim}\u2191 ${scrollOffset} more above${p.reset}`);
    }

    for (let i = scrollOffset; i < scrollOffset + visibleCount && i < items.length; i++) {
      const item = items[i];
      const isHighlighted = i === cursor;
      const selIndex = selections.indexOf(i);
      const isSelected = selIndex !== -1;

      let checkbox: string;
      if (item.disabled) {
        checkbox = `${p.dim} - ${p.reset}`;
      } else if (isSelected) {
        if (ordered) {
          checkbox = `${p.green}[${selIndex + 1}]${p.reset}`;
        } else {
          checkbox = `${p.green}[\u2713]${p.reset}`;
        }
      } else {
        checkbox = `${p.dim}[ ]${p.reset}`;
      }

      const badgeStr = item.badge ? ` ${item.badge}` : "";

      if (item.disabled) {
        output.push(`  ${checkbox} ${p.dim}${item.label}${badgeStr}${p.reset}`);
      } else if (isHighlighted) {
        output.push(
          `  ${p.magentaBold}\u276f${p.reset}${checkbox} ${p.bold}${item.label}${p.reset}${badgeStr}`,
        );
      } else {
        output.push(`   ${checkbox} ${item.label}${badgeStr}`);
      }
    }

    if (hasBelow) {
      output.push(
        `  ${p.dim}\u2193 ${items.length - scrollOffset - visibleCount} more below${p.reset}`,
      );
    }

    // Flash message or hints
    if (flashMessage) {
      output.push(`  ${p.red}${flashMessage}${p.reset}`);
    } else {
      const hints = [
        `${p.dim}\u2191\u2193 move`,
        `space toggle`,
        `a all`,
        `n none`,
        `enter confirm`,
      ];
      if (showQuit) hints.push(`q quit`);
      output.push(`  ${hints.join(`${p.reset}${p.dim}  \u00b7  `)}${p.reset}`);
    }

    // Selection count
    output.push(
      `  ${p.dim}${selections.length} selected${minSelect > 0 ? ` (min ${minSelect})` : ""}${p.reset}`,
    );

    const text = output.join("\n") + "\n";
    process.stdout.write(text);
    renderedLines = output.length;
  };

  return new Promise<number[]>((resolve) => {
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    let done = false;

    const cleanup = (): void => {
      done = true;
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(wasRaw ?? false);
      process.stdin.pause();
      showCursor();
    };

    const exitHandler = (): void => {
      showCursor();
    };
    process.on("exit", exitHandler);

    const flash = (msg: string): void => {
      flashMessage = msg;
      render();
      setTimeout(() => {
        if (done) return;
        flashMessage = "";
        render();
      }, 1200);
    };

    const toggle = (idx: number): void => {
      if (items[idx].disabled) return;
      const pos = selections.indexOf(idx);
      if (pos === -1) {
        selections.push(idx);
      } else {
        selections.splice(pos, 1);
      }
    };

    const selectAll = (): void => {
      selections.length = 0;
      for (let i = 0; i < items.length; i++) {
        if (!items[i].disabled) selections.push(i);
      }
    };

    const deselectAll = (): void => {
      selections.length = 0;
    };

    const onData = (data: string): void => {
      if (data === "\x1b[A" || data === "k") {
        cursor = nextSelectable(items, cursor, -1);
        render();
      } else if (data === "\x1b[B" || data === "j") {
        cursor = nextSelectable(items, cursor, 1);
        render();
      } else if (data === " ") {
        toggle(cursor);
        render();
      } else if (data === "a") {
        selectAll();
        render();
      } else if (data === "n") {
        deselectAll();
        render();
      } else if (data === "\r") {
        if (selections.length < minSelect) {
          flash(`Select at least ${minSelect}`);
          return;
        }
        cleanup();
        process.removeListener("exit", exitHandler);
        resolve([...selections]);
      } else if (data === "q" && showQuit) {
        cleanup();
        process.removeListener("exit", exitHandler);
        resolve([]);
      } else if (data === "\x03") {
        cleanup();
        process.removeListener("exit", exitHandler);
        process.exit(0);
      }
    };

    if (title) {
      console.log(header(title));
    }

    hideCursor();
    render();

    process.stdin.on("data", onData);
  });
}

async function fallbackMultiSelect(
  items: MenuItem[],
  options?: MultiSelectOptions,
): Promise<number[]> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (options?.title) {
      console.log(`\n${p.purpleBold}${options.title}${p.reset}\n`);
    }

    let num = 1;
    const indexMap = new Map<number, number>();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.disabled) {
        const badgeStr = item.badge ? ` ${item.badge}` : "";
        console.log(`  ${p.dim}- ${item.label}${badgeStr}${p.reset}`);
      } else {
        const badgeStr = item.badge ? ` ${item.badge}` : "";
        console.log(`  ${p.bold}${num}.${p.reset} ${item.label}${badgeStr}`);
        indexMap.set(num, i);
        num += 1;
      }
    }

    const ordered = options?.ordered ?? false;
    const minSelect = options?.minSelect ?? 0;
    const showQuit = options?.showQuit ?? true;

    console.log(
      `\n${p.dim}Enter numbers${ordered ? " in order" : ""} (e.g. 1,3,2)${showQuit ? " or q to quit" : ""}.${p.reset}`,
    );

    while (true) {
      const answer = (await rl.question(`${p.magenta}\u276f${p.reset} `)).trim().toLowerCase();
      if ((answer === "q" || answer === "quit") && showQuit) return [];
      if (answer === "none" || answer === "") {
        if (minSelect === 0) return [];
        console.log(`${p.red}Select at least ${minSelect}.${p.reset}`);
        continue;
      }

      const tokens = answer.split(/[,\s]+/).filter((t) => t.length > 0);
      const result: number[] = [];
      const seen = new Set<number>();
      let hasError = false;

      for (const token of tokens) {
        const n = Number.parseInt(token, 10);
        const mapped = indexMap.get(n);
        if (mapped === undefined) {
          console.log(`${p.red}Invalid: ${token}${p.reset}`);
          hasError = true;
          break;
        }
        if (seen.has(n)) {
          console.log(`${p.red}Duplicate: ${token}${p.reset}`);
          hasError = true;
          break;
        }
        seen.add(n);
        result.push(mapped);
      }

      if (hasError) continue;
      if (result.length < minSelect) {
        console.log(`${p.red}Select at least ${minSelect}.${p.reset}`);
        continue;
      }
      return result;
    }
  } finally {
    rl.close();
  }
}

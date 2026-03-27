import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

const scriptPath = join(process.cwd(), "scripts/issue-agent/run-codex.sh");

function makeFakeCodexBin() {
  const dir = mkdtempSync(join(tmpdir(), "issue-agent-codex-bin-"));
  const fakeCodexPath = join(dir, "codex");
  writeFileSync(
    fakeCodexPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" != "exec" ]; then
  echo "unexpected command: $1" >&2
  exit 97
fi
shift
if [ "$1" != "--dangerously-bypass-approvals-and-sandbox" ]; then
  echo "unexpected flag: $1" >&2
  exit 98
fi
shift
printf 'FAKE_CODEX_STDOUT:%s\\n' "$1"
printf 'FAKE_CODEX_STDERR\\n' >&2
exit "\${FAKE_CODEX_EXIT:-0}"
`,
  );
  chmodSync(fakeCodexPath, 0o755);
  return dir;
}

function writePromptFile(contents: string) {
  const dir = mkdtempSync(join(tmpdir(), "issue-agent-prompt-"));
  const promptPath = join(dir, "prompt.txt");
  writeFileSync(promptPath, contents);
  return { dir, promptPath };
}

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("scripts/issue-agent/run-codex.sh", () => {
  it("suppresses successful Codex transcripts unless GitHub debug logging is enabled", () => {
    const fakeCodexBin = makeFakeCodexBin();
    const { dir, promptPath } = writePromptFile("ship fix quietly");
    cleanupPaths.push(fakeCodexBin, dir);

    const result = spawnSync("bash", [scriptPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeCodexBin}:${process.env.PATH ?? ""}`,
        PROMPT_PATH: promptPath,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Codex output suppressed by default.");
    expect(result.stdout).toContain("Codex completed successfully.");
    expect(result.stdout).not.toContain("FAKE_CODEX_STDOUT:ship fix quietly");
    expect(result.stderr).not.toContain("FAKE_CODEX_STDERR");
  });

  it("streams Codex output when GitHub debug logging is enabled", () => {
    const fakeCodexBin = makeFakeCodexBin();
    const { dir, promptPath } = writePromptFile("show everything");
    cleanupPaths.push(fakeCodexBin, dir);

    const result = spawnSync("bash", [scriptPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeCodexBin}:${process.env.PATH ?? ""}`,
        PROMPT_PATH: promptPath,
        RUNNER_DEBUG: "1",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "GitHub Actions debug logging enabled; streaming full Codex output.",
    );
    expect(result.stdout).toContain("FAKE_CODEX_STDOUT:show everything");
    expect(result.stderr).toContain("FAKE_CODEX_STDERR");
  });

  it("prints the captured transcript when Codex fails", () => {
    const fakeCodexBin = makeFakeCodexBin();
    const { dir, promptPath } = writePromptFile("broken run");
    cleanupPaths.push(fakeCodexBin, dir);

    const result = spawnSync("bash", [scriptPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeCodexBin}:${process.env.PATH ?? ""}`,
        PROMPT_PATH: promptPath,
        FAKE_CODEX_EXIT: "23",
      },
    });

    expect(result.status).toBe(23);
    expect(result.stdout).toContain("Codex failed with exit code 23. Full output follows.");
    expect(result.stdout).toContain("FAKE_CODEX_STDOUT:broken run");
    expect(result.stdout).toContain("FAKE_CODEX_STDERR");
  });
});

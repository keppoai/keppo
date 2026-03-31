import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = join(process.cwd(), "scripts/issue-agent/upload-session-logs.sh");
const cleanupPaths: string[] = [];

function makeFakeCurlBin(capturedManifestPath: string) {
  const dir = mkdtempSync(join(tmpdir(), "upload-session-logs-bin-"));
  const fakeCurlPath = join(dir, "curl");
  writeFileSync(
    fakeCurlPath,
    `#!/usr/bin/env bash
set -euo pipefail
captured_manifest_path="${capturedManifestPath}"
manifest=""
for arg in "$@"; do
  case "$arg" in
    --form)
      ;;
    manifest=@*)
      manifest="\${arg#manifest=@}"
      manifest="\${manifest%%;type=*}"
      ;;
  esac
done
if [[ -z "$manifest" ]]; then
  echo "manifest form part not found" >&2
  exit 88
fi
cp "$manifest" "$captured_manifest_path"
cat <<'JSON'
{
  "status": "accepted",
  "files": [
    {
      "part_name": "file_0",
      "relative_path": "sessions/session-2026-03-31T22-00-00.jsonl",
      "status": "stored",
      "viewer_url": "https://agent-logs.keppo.ai/artifacts/asl_test"
    }
  ]
}
JSON
`,
  );
  chmodSync(fakeCurlPath, 0o755);
  cleanupPaths.push(dir);
  return dir;
}

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("scripts/issue-agent/upload-session-logs.sh", () => {
  it("uploads only Codex session logs from the sessions subtree", () => {
    const workDir = mkdtempSync(join(tmpdir(), "upload-session-logs-work-"));
    cleanupPaths.push(workDir);

    const codexHome = join(workDir, "codex-home");
    const sessionsDir = join(codexHome, "sessions");
    const pluginsDir = join(codexHome, ".tmp/plugins/plugins/github/.codex-plugin");
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(pluginsDir, { recursive: true });

    const markerPath = join(workDir, "marker");
    writeFileSync(markerPath, "marker");

    const sessionLogPath = join(sessionsDir, "session-2026-03-31T22-00-00.jsonl");
    const pluginJsonPath = join(pluginsDir, "plugin.json");
    writeFileSync(sessionLogPath, '{"event":"session"}\n');
    writeFileSync(pluginJsonPath, '{"junk":"plugin metadata"}\n');

    const commentPath = join(workDir, "session-log-comment.md");
    const capturedManifestPath = join(workDir, "captured-manifest.json");
    const fakeCurlBin = makeFakeCurlBin(capturedManifestPath);

    const result = spawnSync("bash", [scriptPath], {
      cwd: workDir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeCurlBin}:${process.env.PATH ?? ""}`,
        AGENT_KIND: "codex",
        GITHUB_REPOSITORY: "keppoai/keppo",
        GITHUB_RUN_ID: "12345",
        GITHUB_RUN_ATTEMPT: "1",
        LOG_MARKER_PATH: markerPath,
        CODEX_HOME: codexHome,
        SESSION_LOG_COMMENT_PATH: commentPath,
        KEPPO_SESSION_LOG_UPLOAD_URL: "https://agent-logs.keppo.ai/upload",
        KEPPO_SESSION_LOG_UPLOAD_TOKEN: "test-token",
      },
    });

    expect(result.status).toBe(0);

    const manifest = JSON.parse(readFileSync(capturedManifestPath, "utf8")) as {
      files: Array<{ relative_path: string }>;
    };
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0]?.relative_path).toBe("sessions/session-2026-03-31T22-00-00.jsonl");

    const commentBody = readFileSync(commentPath, "utf8");
    expect(commentBody).toContain("`sessions/session-2026-03-31T22-00-00.jsonl`");
    expect(commentBody).not.toContain("plugin.json");
  });
});

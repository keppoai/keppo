import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = join(process.cwd(), "scripts/issue-agent/upload-session-logs.sh");
const cleanupPaths: string[] = [];

function makeFakeCurlBin(
  capturedPreparePath: string,
  capturedCompletePath: string,
  capturedBlobUploadPath: string,
  prepareResponseBody = `{
  "status": "prepared",
  "complete_url": "https://agent-logs.keppo.ai/upload/complete",
  "files": [
    {
      "part_name": "file_0",
      "relative_path": "sessions/session-2026-03-31T22-00-00.jsonl",
      "status": "upload_required",
      "upload_path": "system/pending-uploads/upload-test/file_0-sha-session.jsonl",
      "client_token": "vercel_blob_client_test_token"
    }
  ]
}`,
) {
  const dir = mkdtempSync(join(tmpdir(), "upload-session-logs-bin-"));
  const fakeCurlPath = join(dir, "curl");
  writeFileSync(
    fakeCurlPath,
    `#!/usr/bin/env bash
set -euo pipefail
captured_prepare_path="${capturedPreparePath}"
captured_complete_path="${capturedCompletePath}"
captured_blob_upload_path="${capturedBlobUploadPath}"
method="GET"
url=""
data_file=""
auth_header=""
for ((i=1; i <= $#; i++)); do
  arg="\${!i}"
  case "$arg" in
    --request)
      j=$((i + 1))
      method="\${!j}"
      ;;
    --url)
      j=$((i + 1))
      url="\${!j}"
      ;;
    --data-binary)
      j=$((i + 1))
      data_file="\${!j}"
      ;;
    --header)
      j=$((i + 1))
      header_value="\${!j}"
      if [[ "$header_value" == Authorization:* ]]; then
        auth_header="$header_value"
      fi
      ;;
  esac
done

if [[ "$method" == "POST" && "$url" == "https://agent-logs.keppo.ai/upload" ]]; then
  data_file="\${data_file#@}"
  cp "$data_file" "$captured_prepare_path"
  cat <<'JSON'
${prepareResponseBody}
JSON
  exit 0
fi

if [[ "$method" == "PUT" && "$url" == "https://vercel.com/api/blob?pathname=system%2Fpending-uploads%2Fupload-test%2Ffile_0-sha-session.jsonl" ]]; then
  data_file="\${data_file#@}"
  cp "$data_file" "$captured_blob_upload_path"
  if [[ "$auth_header" != "Authorization: Bearer vercel_blob_client_test_token" ]]; then
    echo "unexpected blob auth header: $auth_header" >&2
    exit 89
  fi
  cat <<'JSON'
{"url":"https://blob.example.test/private","pathname":"system/pending-uploads/upload-test/file_0-sha-session.jsonl"}
JSON
  exit 0
fi

if [[ "$method" == "POST" && "$url" == "https://agent-logs.keppo.ai/upload/complete" ]]; then
  data_file="\${data_file#@}"
  cp "$data_file" "$captured_complete_path"
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
  exit 0
fi

echo "unexpected curl invocation: method=$method url=$url" >&2
exit 90
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
    const capturedPreparePath = join(workDir, "captured-prepare.json");
    const capturedCompletePath = join(workDir, "captured-complete.json");
    const capturedBlobUploadPath = join(workDir, "captured-blob-upload.jsonl");
    const fakeCurlBin = makeFakeCurlBin(
      capturedPreparePath,
      capturedCompletePath,
      capturedBlobUploadPath,
    );

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

    const prepareRequest = JSON.parse(readFileSync(capturedPreparePath, "utf8")) as {
      manifest: { files: Array<{ relative_path: string }> };
    };
    expect(prepareRequest.manifest.files).toHaveLength(1);
    expect(prepareRequest.manifest.files[0]?.relative_path).toBe(
      "sessions/session-2026-03-31T22-00-00.jsonl",
    );

    const completeRequest = JSON.parse(readFileSync(capturedCompletePath, "utf8")) as {
      manifest: { files: Array<{ relative_path: string }> };
    };
    expect(completeRequest.manifest.files).toHaveLength(1);
    expect(completeRequest.manifest.files[0]?.relative_path).toBe(
      "sessions/session-2026-03-31T22-00-00.jsonl",
    );

    const blobUploadBody = readFileSync(capturedBlobUploadPath, "utf8");
    expect(blobUploadBody).toContain('{"event":"session"}');

    const commentBody = readFileSync(commentPath, "utf8");
    expect(commentBody).toContain("`sessions/session-2026-03-31T22-00-00.jsonl`");
    expect(commentBody).not.toContain("plugin.json");
  });

  it("redacts client_token fields from prepare-response failures before printing logs", () => {
    const workDir = mkdtempSync(join(tmpdir(), "upload-session-logs-redaction-work-"));
    cleanupPaths.push(workDir);

    const codexHome = join(workDir, "codex-home");
    const sessionsDir = join(codexHome, "sessions");
    mkdirSync(sessionsDir, { recursive: true });

    const markerPath = join(workDir, "marker");
    writeFileSync(markerPath, "marker");

    const sessionLogPath = join(sessionsDir, "session-2026-03-31T22-00-00.jsonl");
    writeFileSync(sessionLogPath, '{"event":"session"}\n');

    const fakeCurlBin = makeFakeCurlBin(
      join(workDir, "captured-prepare.json"),
      join(workDir, "captured-complete.json"),
      join(workDir, "captured-blob-upload.jsonl"),
      `{
  "status": "prepared",
  "complete_url": "https://agent-logs.keppo.ai/upload/complete",
  "files": [
    {
      "part_name": "file_0",
      "relative_path": "sessions/session-2026-03-31T22-00-00.jsonl",
      "status": "upload_required",
      "client_token": "opaque-live-upload-token"
    }
  ]
}`,
    );

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
        KEPPO_SESSION_LOG_UPLOAD_URL: "https://agent-logs.keppo.ai/upload",
        KEPPO_SESSION_LOG_UPLOAD_TOKEN: "test-token",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[REDACTED_CLIENT_TOKEN]");
    expect(result.stderr).not.toContain("opaque-live-upload-token");
    expect(result.stderr).toContain("Session log prepare response validation failed");
  });
});

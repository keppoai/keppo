import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = join(process.cwd(), "scripts/issue-agent/download-uploaded-artifacts.sh");
const cleanupPaths: string[] = [];

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function makeUploadRecord(bundleSha: string, bundleSize: number) {
  return {
    upload_id: "upload-123",
    manifest: {
      schema_version: 1,
      source: "github_actions",
      upload_id: "upload-123",
      uploaded_at: "2026-04-07T07:00:00Z",
      agent_kind: "codex",
      repository: { full_name: "keppoai/keppo" },
      github: {
        workflow: "issue-agent-issue-to-pr",
        job: "issue-agent",
        run_id: "12345",
        run_attempt: 1,
        event_name: "issues",
        sha: "0123456789abcdef0123456789abcdef01234567",
      },
      files: [
        {
          part_name: "file_0",
          root_label: "issue-agent-handoff",
          relative_path: "branch.bundle",
          filename: "branch.bundle",
          content_type: "application/octet-stream",
          size_bytes: bundleSize,
          sha256_hex: bundleSha,
        },
        {
          part_name: "file_1",
          root_label: "codex-home",
          relative_path: "sessions/session-1.jsonl",
          filename: "session-1.jsonl",
          content_type: "application/x-ndjson",
          size_bytes: 14,
          sha256_hex: sha256Hex('{"event":1}\n'),
        },
      ],
    },
    response: {
      upload_id: "upload-123",
      status: "accepted",
      repository: "keppoai/keppo",
      run: {
        workflow: "issue-agent-issue-to-pr",
        job: "issue-agent",
        run_id: "12345",
        run_attempt: 1,
      },
      summary: {
        received_files: 2,
        stored_files: 2,
        duplicate_files: 0,
        rejected_files: 0,
        total_bytes: bundleSize + 14,
      },
      files: [
        {
          part_name: "file_0",
          relative_path: "branch.bundle",
          sha256_hex: bundleSha,
          status: "stored",
          artifact_id: "asl_bundle",
          storage_key: "github-actions/keppoai/keppo/run-12345/branch.bundle",
          viewer_url: "https://agent-logs.keppo.ai/artifacts/asl_bundle",
          download_url: "https://agent-logs.keppo.ai/artifacts/asl_bundle/download",
        },
        {
          part_name: "file_1",
          relative_path: "sessions/session-1.jsonl",
          sha256_hex: sha256Hex('{"event":1}\n'),
          status: "stored",
          artifact_id: "asl_log",
          storage_key: "github-actions/keppoai/keppo/run-12345/session-1.jsonl",
          viewer_url: "https://agent-logs.keppo.ai/artifacts/asl_log",
          download_url: "https://agent-logs.keppo.ai/artifacts/asl_log/download",
        },
      ],
    },
  };
}

function makeFakeCurlBin(
  uploadRecordBody: string,
  bundleContents: string,
  options?: {
    downloadContentType?: string;
    includeHardeningHeaders?: boolean;
  },
) {
  const dir = mkdtempSync(join(tmpdir(), "download-uploaded-artifacts-bin-"));
  const fakeCurlPath = join(dir, "curl");
  const downloadContentType = options?.downloadContentType ?? "application/octet-stream";
  const includeHardeningHeaders = options?.includeHardeningHeaders ?? true;
  const hardeningHeaders = includeHardeningHeaders
    ? "    printf 'X-Content-Type-Options: nosniff\\r\\n'\n    printf 'X-Frame-Options: DENY\\r\\n'\n"
    : "";
  writeFileSync(
    fakeCurlPath,
    `#!/usr/bin/env bash
set -euo pipefail
method="GET"
url=""
auth_header=""
output_path=""
dump_header_path=""
write_out=""
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
    --header)
      j=$((i + 1))
      header_value="\${!j}"
      if [[ "$header_value" == Authorization:* ]]; then
        auth_header="$header_value"
      fi
      ;;
    --output)
      j=$((i + 1))
      output_path="\${!j}"
      ;;
    --dump-header)
      j=$((i + 1))
      dump_header_path="\${!j}"
      ;;
    --write-out)
      j=$((i + 1))
      write_out="\${!j}"
      ;;
  esac
done

if [[ "$auth_header" != "Authorization: Bearer test-token" ]]; then
  echo "unexpected auth header: $auth_header" >&2
  exit 91
fi

if [[ "$method" == "GET" && "$url" == "https://agent-logs.keppo.ai/uploads/upload-123" ]]; then
  if [[ -n "$output_path" ]]; then
    cat <<'JSON' > "$output_path"
${uploadRecordBody}
JSON
  else
    cat <<'JSON'
${uploadRecordBody}
JSON
  fi
  if [[ "$write_out" == '%{http_code}' ]]; then
    printf '200'
  fi
  exit 0
fi

if [[ "$method" == "GET" && "$url" == "https://agent-logs.keppo.ai/artifacts/asl_bundle/download" ]]; then
  {
    printf 'HTTP/1.1 200 OK\\r\\n'
    printf 'Content-Type: ${downloadContentType}\\r\\n'
    printf 'X-Keppo-Artifact-Id: asl_bundle\\r\\n'
    printf 'X-Keppo-Artifact-Sha256: ${sha256Hex(bundleContents)}\\r\\n'
${hardeningHeaders}\
    printf '\\r\\n'
  } > "$dump_header_path"
  printf '%s' '${bundleContents}' > "$output_path"
  if [[ "$write_out" == '%{http_code}' ]]; then
    printf '200'
  fi
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

describe("scripts/issue-agent/download-uploaded-artifacts.sh", () => {
  it("downloads only the selected root labels and writes the upload record", () => {
    const workDir = mkdtempSync(join(tmpdir(), "download-uploaded-artifacts-work-"));
    cleanupPaths.push(workDir);

    const bundleContents = "bundle-bytes";
    const fakeCurlBin = makeFakeCurlBin(
      JSON.stringify(makeUploadRecord(sha256Hex(bundleContents), bundleContents.length)),
      bundleContents,
    );
    const destinationRoot = join(workDir, "downloaded");
    const uploadRecordPath = join(workDir, "upload-record.json");

    const result = spawnSync("bash", [scriptPath], {
      cwd: workDir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeCurlBin}:${process.env.PATH ?? ""}`,
        UPLOAD_ID: "upload-123",
        DOWNLOAD_DESTINATION_ROOT: destinationRoot,
        DOWNLOAD_ROOT_LABELS: "issue-agent-handoff",
        UPLOAD_RECORD_PATH: uploadRecordPath,
        KEPPO_SESSION_LOG_UPLOAD_URL: "https://agent-logs.keppo.ai/upload",
        KEPPO_SESSION_LOG_UPLOAD_TOKEN: "test-token",
      },
    });

    expect(result.status).toBe(0);
    expect(
      readFileSync(join(destinationRoot, "issue-agent-handoff", "branch.bundle"), "utf8"),
    ).toBe(bundleContents);
    expect(existsSync(join(destinationRoot, "codex-home", "sessions", "session-1.jsonl"))).toBe(
      false,
    );

    const uploadRecord = JSON.parse(readFileSync(uploadRecordPath, "utf8")) as {
      upload_id: string;
    };
    expect(uploadRecord.upload_id).toBe("upload-123");
  });

  it("fails closed when the download route serves a different artifact id", () => {
    const workDir = mkdtempSync(join(tmpdir(), "download-uploaded-artifacts-bad-id-"));
    cleanupPaths.push(workDir);

    const bundleContents = "bundle-bytes";
    const fakeCurlBin = makeFakeCurlBin(
      JSON.stringify(makeUploadRecord(sha256Hex(bundleContents), bundleContents.length)),
      bundleContents,
    );
    const originalCurlPath = join(fakeCurlBin, "curl");
    const rewrittenCurlPath = readFileSync(originalCurlPath, "utf8").replace(
      "X-Keppo-Artifact-Id: asl_bundle",
      "X-Keppo-Artifact-Id: asl_other",
    );
    writeFileSync(originalCurlPath, rewrittenCurlPath);
    chmodSync(originalCurlPath, 0o755);

    const result = spawnSync("bash", [scriptPath], {
      cwd: workDir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeCurlBin}:${process.env.PATH ?? ""}`,
        UPLOAD_ID: "upload-123",
        DOWNLOAD_DESTINATION_ROOT: join(workDir, "downloaded"),
        DOWNLOAD_ROOT_LABELS: "issue-agent-handoff",
        KEPPO_SESSION_LOG_UPLOAD_URL: "https://agent-logs.keppo.ai/upload",
        KEPPO_SESSION_LOG_UPLOAD_TOKEN: "test-token",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("artifact id mismatch");
  });

  it("fails closed when a downloaded artifact digest does not match the upload record", () => {
    const workDir = mkdtempSync(join(tmpdir(), "download-uploaded-artifacts-bad-sha-"));
    cleanupPaths.push(workDir);

    const fakeCurlBin = makeFakeCurlBin(
      JSON.stringify(makeUploadRecord("a".repeat(64), "bundle-bytes".length)),
      "bundle-bytes",
    );

    const result = spawnSync("bash", [scriptPath], {
      cwd: workDir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeCurlBin}:${process.env.PATH ?? ""}`,
        UPLOAD_ID: "upload-123",
        DOWNLOAD_DESTINATION_ROOT: join(workDir, "downloaded"),
        DOWNLOAD_ROOT_LABELS: "issue-agent-handoff",
        KEPPO_SESSION_LOG_UPLOAD_URL: "https://agent-logs.keppo.ai/upload",
        KEPPO_SESSION_LOG_UPLOAD_TOKEN: "test-token",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sha256");
  });

  it("accepts a matching content type with a charset suffix", () => {
    const workDir = mkdtempSync(join(tmpdir(), "download-uploaded-artifacts-charset-"));
    cleanupPaths.push(workDir);

    const bundleContents = "bundle-bytes";
    const fakeCurlBin = makeFakeCurlBin(
      JSON.stringify(makeUploadRecord(sha256Hex(bundleContents), bundleContents.length)),
      bundleContents,
      { downloadContentType: "application/octet-stream; charset=utf-8" },
    );

    const result = spawnSync("bash", [scriptPath], {
      cwd: workDir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeCurlBin}:${process.env.PATH ?? ""}`,
        UPLOAD_ID: "upload-123",
        DOWNLOAD_DESTINATION_ROOT: join(workDir, "downloaded"),
        DOWNLOAD_ROOT_LABELS: "issue-agent-handoff",
        KEPPO_SESSION_LOG_UPLOAD_URL: "https://agent-logs.keppo.ai/upload",
        KEPPO_SESSION_LOG_UPLOAD_TOKEN: "test-token",
      },
    });

    expect(result.status).toBe(0);
  });

  it("fails closed when the upload record contains an unsafe root label", () => {
    const workDir = mkdtempSync(join(tmpdir(), "download-uploaded-artifacts-bad-root-label-"));
    cleanupPaths.push(workDir);

    const bundleContents = "bundle-bytes";
    const uploadRecord = makeUploadRecord(sha256Hex(bundleContents), bundleContents.length);
    uploadRecord.manifest.files[0]!.root_label = "../evil";
    const fakeCurlBin = makeFakeCurlBin(JSON.stringify(uploadRecord), bundleContents);

    const result = spawnSync("bash", [scriptPath], {
      cwd: workDir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeCurlBin}:${process.env.PATH ?? ""}`,
        UPLOAD_ID: "upload-123",
        DOWNLOAD_DESTINATION_ROOT: join(workDir, "downloaded"),
        KEPPO_SESSION_LOG_UPLOAD_URL: "https://agent-logs.keppo.ai/upload",
        KEPPO_SESSION_LOG_UPLOAD_TOKEN: "test-token",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unsafe root_label");
  });

  it("fails closed when the upload record download_url does not match the expected artifact route", () => {
    const workDir = mkdtempSync(join(tmpdir(), "download-uploaded-artifacts-bad-url-"));
    cleanupPaths.push(workDir);

    const bundleContents = "bundle-bytes";
    const uploadRecord = makeUploadRecord(sha256Hex(bundleContents), bundleContents.length);
    uploadRecord.response.files[0]!.download_url =
      "https://evil.example/artifacts/asl_bundle/download";
    const fakeCurlBin = makeFakeCurlBin(JSON.stringify(uploadRecord), bundleContents);

    const result = spawnSync("bash", [scriptPath], {
      cwd: workDir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeCurlBin}:${process.env.PATH ?? ""}`,
        UPLOAD_ID: "upload-123",
        DOWNLOAD_DESTINATION_ROOT: join(workDir, "downloaded"),
        KEPPO_SESSION_LOG_UPLOAD_URL: "https://agent-logs.keppo.ai/upload",
        KEPPO_SESSION_LOG_UPLOAD_TOKEN: "test-token",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unexpected download_url");
  });
});

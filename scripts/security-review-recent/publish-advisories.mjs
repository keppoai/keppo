import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { extractFirstJsonObject } from "../pr-review/extract-json.mjs";

const GITHUB_API_VERSION = "2022-11-28";
const MAILGUN_API_BASE_URL = "https://api.mailgun.net/v3";
const DEFAULT_ADVISORY_COLLABORATOR = "wwwillchen";
const MAX_ADVISORIES_FOR_MODEL = 12;
const MAX_MODEL_TEXT_CHARS = 1200;
const MAX_CODEX_OUTPUT_CHARS = 200_000;
const CODEX_TIMEOUT_MS = 60_000;

const pickEnv = (source, keys) =>
  Object.fromEntries(
    keys
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  );

const readResponseBody = async (response) => {
  const text = await response.text();
  return text.trim().slice(0, 1000);
};

const normalizeFreeText = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const truncate = (value, maxChars = MAX_MODEL_TEXT_CHARS) => {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 1)}…`;
};

const tokenizeForSimilarity = (value) =>
  new Set(
    normalizeFreeText(value)
      .split(/\s+/)
      .filter((token) => token.length >= 3),
  );

const advisorySupportsLocalDedupe = (advisory) =>
  ["triage", "draft", "published"].includes(String(advisory?.state || "").toLowerCase());

const advisorySupportsSemanticDedupe = (advisory) =>
  String(advisory?.state || "").toLowerCase() === "published";

const scoreAdvisorySimilarity = (finding, advisory) => {
  const findingTokens = tokenizeForSimilarity(`${finding.title} ${finding.description}`);
  const advisoryTokens = tokenizeForSimilarity(
    `${String(advisory.summary || "")} ${String(advisory.description || "")}`,
  );

  let overlap = 0;
  for (const token of findingTokens) {
    if (advisoryTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap;
};

const requireEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const getNextPageUrl = (linkHeader) => {
  if (!linkHeader) {
    return null;
  }

  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) {
      return match[1];
    }
  }

  return null;
};

const parseRecipients = (value) => {
  const seen = new Set();
  const recipients = [];

  for (const raw of value.split(",")) {
    const email = raw.trim();
    if (!email || seen.has(email)) {
      continue;
    }
    seen.add(email);
    recipients.push(email);
  }

  if (recipients.length === 0) {
    throw new Error("SECURITY_ADVISORY_ALERT_EMAILS must contain at least one address");
  }

  return recipients;
};

const appendStepSummary = async (line) => {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) {
    return;
  }
  await fs.appendFile(path, `${line}\n`, "utf8");
};

const loadSessionLogLinks = async (path) => {
  if (!path) {
    return [];
  }

  let raw;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return raw
    .split("\n")
    .map((line) => line.match(/^- `([^`]+)`: (https?:\/\/\S+)$/))
    .filter(Boolean)
    .map(([, label, url]) => ({ label, url }));
};

const loadFindings = async (path) => {
  const raw = (await fs.readFile(path, "utf8")).trim();
  if (!raw) {
    return [];
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("findings.json must contain a JSON array");
  }
  return parsed.map((finding, index) => {
    const title = String(finding?.title ?? "").trim();
    const description = String(finding?.description ?? "").trim();
    const severity = String(finding?.severity ?? "")
      .trim()
      .toLowerCase();
    if (!title || !description || !["critical", "high"].includes(severity)) {
      throw new Error(`Invalid finding at index ${index}`);
    }
    return {
      title: title.slice(0, 256),
      description,
      severity,
    };
  });
};

const parseJsonObject = (value) => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Codex returned an empty response");
  }

  try {
    return JSON.parse(trimmed);
  } catch {}

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    try {
      return JSON.parse(fencedMatch[1]);
    } catch {}
  }

  let firstBrace = trimmed.indexOf("{");
  while (firstBrace >= 0) {
    const candidate = extractFirstJsonObject(trimmed.slice(firstBrace));
    try {
      return JSON.parse(candidate);
    } catch {}
    firstBrace = trimmed.indexOf("{", firstBrace + 1);
  }

  throw new Error("Codex did not return parseable JSON");
};

const buildCodexExecArgs = () => [
  "exec",
  "--skip-git-repo-check",
  "--sandbox",
  "read-only",
  "--disable",
  "responses_websockets",
  "-",
];

const buildCodexExecEnv = (env = process.env) =>
  pickEnv(env, [
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_ORG_ID",
    "OPENAI_PROJECT_ID",
    "NO_COLOR",
    "FORCE_COLOR",
  ]);

const appendLimited = (value, chunk) => {
  if (value.length >= MAX_CODEX_OUTPUT_CHARS) {
    return value;
  }
  const remaining = MAX_CODEX_OUTPUT_CHARS - value.length;
  return value + chunk.slice(0, remaining);
};

const runCodexPrompt = async (prompt) => {
  const sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "security-review-codex-"));

  try {
    return await new Promise((resolve, reject) => {
      const child = spawn("codex", buildCodexExecArgs(), {
        cwd: sandboxDir,
        env: buildCodexExecEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;
      let exceededOutputLimit = false;
      let killTimer = null;

      const clearKillTimer = () => {
        if (killTimer) {
          clearTimeout(killTimer);
          killTimer = null;
        }
      };

      const finish = (callback) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        clearKillTimer();
        callback();
      };

      const terminateChild = (reason) => {
        if (child.exitCode !== null || child.killed) {
          return;
        }
        stderr = appendLimited(stderr, `\n${reason}`);
        child.kill("SIGTERM");
        killTimer = setTimeout(() => {
          if (child.exitCode === null && !child.killed) {
            child.kill("SIGKILL");
          }
        }, 5_000);
      };

      const timeoutId = setTimeout(() => {
        timedOut = true;
        terminateChild(`Codex timed out after ${CODEX_TIMEOUT_MS}ms`);
      }, CODEX_TIMEOUT_MS);

      const handleOutput = (target, chunk) => {
        const text = chunk.toString();
        const nextValue = appendLimited(target(), text);
        if (target === getStdout) {
          stdout = nextValue;
        } else {
          stderr = nextValue;
        }
        if (!exceededOutputLimit && nextValue.length >= MAX_CODEX_OUTPUT_CHARS) {
          exceededOutputLimit = true;
          terminateChild("Codex output exceeded limit");
        }
      };

      const getStdout = () => stdout;
      const getStderr = () => stderr;

      child.stdout.on("data", (chunk) => {
        handleOutput(getStdout, chunk);
      });
      child.stderr.on("data", (chunk) => {
        handleOutput(getStderr, chunk);
      });
      child.on("error", (error) => {
        finish(() => reject(error));
      });
      child.on("close", (code, signal) => {
        finish(() => {
          if (code === 0 && !timedOut && !exceededOutputLimit) {
            resolve(stdout);
            return;
          }

          const reason = timedOut
            ? `timed out after ${CODEX_TIMEOUT_MS}ms`
            : exceededOutputLimit
              ? `exceeded ${MAX_CODEX_OUTPUT_CHARS} chars of output`
              : signal
                ? `terminated by signal ${signal}`
                : `failed with exit code ${code}`;
          reject(new Error(`Codex dedupe prompt ${reason}: ${stderr.trim().slice(0, 1000)}`));
        });
      });

      child.stdin.end(prompt);
    });
  } finally {
    await fs.rm(sandboxDir, { recursive: true, force: true });
  }
};

const buildCreateRepositoryAdvisoryPayload = ({
  repositoryName,
  finding,
  advisoryCollaborator,
}) => ({
  summary: finding.title,
  description: [
    finding.description,
    "",
    "This draft advisory was generated by the nightly `security-review:recent` workflow as defensive security research on an open-source project in coordination with the maintainer.",
  ].join("\n"),
  severity: finding.severity,
  cve_id: null,
  vulnerabilities: [
    {
      package: {
        ecosystem: "other",
        name: repositoryName,
      },
      vulnerable_version_range: null,
      patched_versions: null,
      vulnerable_functions: [],
    },
  ],
  ...(advisoryCollaborator
    ? {
        credits: [
          {
            login: advisoryCollaborator,
            type: "coordinator",
          },
        ],
      }
    : {}),
  start_private_fork: false,
});

const fetchExistingAdvisories = async ({ apiBaseUrl, repo, token }) => {
  let nextUrl = new URL(`${apiBaseUrl}/repos/${repo}/security-advisories`);
  nextUrl.searchParams.set("per_page", "100");

  const advisories = [];
  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
    });

    if (!response.ok) {
      const body = await readResponseBody(response);
      throw new Error(`Failed to list repository security advisories: ${response.status} ${body}`);
    }

    const page = await response.json();
    if (!Array.isArray(page)) {
      throw new Error("Unexpected advisory list response shape");
    }
    advisories.push(...page);
    const nextPage = getNextPageUrl(response.headers.get("link"));
    nextUrl = nextPage ? new URL(nextPage) : null;
  }

  return advisories;
};

const createRepositoryAdvisory = async ({
  apiBaseUrl,
  repo,
  token,
  repositoryName,
  finding,
  advisoryCollaborator,
}) => {
  const response = await fetch(`${apiBaseUrl}/repos/${repo}/security-advisories`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      buildCreateRepositoryAdvisoryPayload({
        repositoryName,
        finding,
        advisoryCollaborator,
      }),
    ),
  });

  if (!response.ok) {
    const body = await readResponseBody(response);
    throw new Error(`Failed to create advisory "${finding.title}": ${response.status} ${body}`);
  }

  return response.json();
};

const advisoryFingerprint = (advisory) =>
  normalizeFreeText(`${String(advisory.summary || "")}\n${String(advisory.description || "")}`);

const findingFingerprint = (finding) =>
  normalizeFreeText(`${String(finding.title || "")}\n${String(finding.description || "")}`);

const findLocalExactDuplicate = ({ finding, advisories }) => {
  const fingerprint = findingFingerprint(finding);
  if (!fingerprint) {
    return null;
  }

  const match = advisories.find(
    (advisory) =>
      advisorySupportsLocalDedupe(advisory) && advisoryFingerprint(advisory) === fingerprint,
  );
  if (!match) {
    return null;
  }

  return {
    advisory: match,
    reason: "exact duplicate of existing advisory",
  };
};

const buildSemanticDuplicateWorkItems = ({ findings, advisories }) =>
  findings
    .map((finding, findingIndex) => ({
      findingIndex,
      finding,
      candidates: advisories
        .filter(advisorySupportsSemanticDedupe)
        .map((advisory) => ({
          advisory,
          score: scoreAdvisorySimilarity(finding, advisory),
        }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, MAX_ADVISORIES_FOR_MODEL)
        .map(({ advisory }, candidateIndex) => ({
          advisory,
          candidateIndex,
          ghsaId: String(advisory.ghsa_id || ""),
          state: String(advisory.state || ""),
          summary: truncate(String(advisory.summary || "")),
          description: truncate(String(advisory.description || "")),
        })),
    }))
    .filter((item) => item.candidates.length > 0);

const buildSemanticDuplicatePrompt = (workItems) =>
  [
    "You are deduplicating GitHub repository security advisories.",
    "For each proposed finding, decide whether it is the same underlying vulnerability as one existing published advisory.",
    "Only mark a duplicate when they describe materially the same vulnerable behavior or exploit path.",
    "Return JSON only with this schema:",
    '{"matches":[{"findingIndex":number,"duplicateIndex":number|null,"confidence":"high"|"low","reason":string}]}',
    "",
    "Work items:",
    JSON.stringify(
      workItems.map(({ findingIndex, finding, candidates }) => ({
        findingIndex,
        finding: {
          title: finding.title,
          severity: finding.severity,
          description: truncate(finding.description),
        },
        candidates: candidates.map(({ advisory, ...candidate }) => candidate),
      })),
      null,
      2,
    ),
    "",
    "Rules:",
    "- `findingIndex` must match one of the provided work items.",
    "- `duplicateIndex` refers to the candidateIndex within that work item's candidates array.",
    "- If none are clearly the same vulnerability, set duplicateIndex to null.",
    "- If you are uncertain, set confidence to low.",
  ].join("\n");

const parseSemanticDuplicateMatches = (parsed, workItems) => {
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.matches)) {
    return [];
  }

  const workItemsByIndex = new Map(workItems.map((item) => [item.findingIndex, item]));
  const matches = [];

  for (const rawMatch of parsed.matches) {
    if (!rawMatch || typeof rawMatch !== "object") {
      continue;
    }

    const findingIndex = rawMatch.findingIndex;
    const duplicateIndex = rawMatch.duplicateIndex;
    if (
      typeof findingIndex !== "number" ||
      !Number.isInteger(findingIndex) ||
      rawMatch.confidence !== "high"
    ) {
      continue;
    }

    const workItem = workItemsByIndex.get(findingIndex);
    if (!workItem) {
      continue;
    }

    if (duplicateIndex == null) {
      continue;
    }

    if (
      typeof duplicateIndex !== "number" ||
      !Number.isInteger(duplicateIndex) ||
      duplicateIndex < 0 ||
      duplicateIndex >= workItem.candidates.length
    ) {
      continue;
    }

    const matchedCandidate = workItem.candidates[duplicateIndex];
    if (!matchedCandidate) {
      continue;
    }

    matches.push({
      findingIndex,
      advisory: matchedCandidate.advisory,
      reason: String(rawMatch.reason || "").trim() || "semantic duplicate",
    });
  }

  return matches;
};

const findSemanticDuplicates = async ({ findings, advisories }) => {
  const workItems = buildSemanticDuplicateWorkItems({ findings, advisories });
  if (workItems.length === 0) {
    return {
      matchesByFindingIndex: new Map(),
      audit: {
        skippedBecauseModelFailed: [],
      },
    };
  }

  let parsed;
  try {
    parsed = parseJsonObject(await runCodexPrompt(buildSemanticDuplicatePrompt(workItems)));
  } catch (error) {
    const titles = workItems.map(({ finding }) => finding.title);
    console.warn(
      `Codex semantic dedupe failed for ${titles.length} finding(s). Proceeding without semantic dedupe. ${String(error)}`,
    );
    return {
      matchesByFindingIndex: new Map(),
      audit: {
        skippedBecauseModelFailed: titles,
      },
    };
  }

  return {
    matchesByFindingIndex: new Map(
      parseSemanticDuplicateMatches(parsed, workItems).map((match) => [
        match.findingIndex,
        {
          advisory: match.advisory,
          reason: match.reason,
        },
      ]),
    ),
    audit: {
      skippedBecauseModelFailed: [],
    },
  };
};

const sendMailgunEmail = async ({ apiKey, domain, from, recipients, subject, text, html }) => {
  const response = await fetch(`${MAILGUN_API_BASE_URL}/${domain}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      from,
      to: recipients.join(","),
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    const body = await readResponseBody(response);
    throw new Error(`Failed to send Mailgun alert: ${response.status} ${body}`);
  }
};

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const main = async () => {
  const findingsPath = process.env.FINDINGS_PATH?.trim() || "out-security-review/findings.json";
  const findings = await loadFindings(findingsPath);

  await appendStepSummary(`Findings reviewed: ${findings.length}`);

  if (findings.length === 0) {
    console.log("No confirmed critical/high vulnerabilities to file.");
    await appendStepSummary("Created advisories: 0");
    return;
  }

  const token = requireEnv("SECURITY_ADVISORY_TOKEN");
  const repo = requireEnv("GITHUB_REPOSITORY");
  const recipients = parseRecipients(requireEnv("SECURITY_ADVISORY_ALERT_EMAILS"));
  const mailgunApiKey = requireEnv("MAILGUN_API_KEY");
  const mailgunDomain = requireEnv("MAILGUN_DOMAIN");
  const fromEmail = requireEnv("MAILGUN_FROM_EMAIL");
  const apiBaseUrl = process.env.GITHUB_API_URL?.trim() || "https://api.github.com";
  const serverUrl = process.env.GITHUB_SERVER_URL?.trim() || "https://github.com";
  const runId = process.env.GITHUB_RUN_ID?.trim();
  const repositoryName = repo.split("/")[1] || "unknown";
  const advisoryCollaborator =
    process.env.SECURITY_ADVISORY_COLLABORATOR?.trim() || DEFAULT_ADVISORY_COLLABORATOR;
  const sessionLogLinks = await loadSessionLogLinks(process.env.SESSION_LOG_COMMENT_PATH?.trim());

  const existing = await fetchExistingAdvisories({ apiBaseUrl, repo, token });
  const existingSnapshot = [...existing];
  const created = [];
  const skipped = [];
  const exactDuplicatesByFindingIndex = new Map();
  const findingsNeedingSemanticDedupe = [];
  const semanticAudit = {
    skippedBecauseModelFailed: [],
  };

  for (const [findingIndex, finding] of findings.entries()) {
    const exactDuplicate = findLocalExactDuplicate({
      finding,
      advisories: existingSnapshot,
    });
    if (exactDuplicate) {
      exactDuplicatesByFindingIndex.set(findingIndex, exactDuplicate);
      continue;
    }
    findingsNeedingSemanticDedupe.push({
      findingIndex,
      finding,
    });
  }

  const semanticDuplicates = await findSemanticDuplicates({
    findings: findingsNeedingSemanticDedupe.map(({ finding }) => finding),
    advisories: existingSnapshot,
  });
  semanticAudit.skippedBecauseModelFailed.push(...semanticDuplicates.audit.skippedBecauseModelFailed);

  const semanticDuplicatesByFindingIndex = new Map();
  for (const [relativeFindingIndex, duplicate] of semanticDuplicates.matchesByFindingIndex) {
    const workItem = findingsNeedingSemanticDedupe[relativeFindingIndex];
    if (!workItem) {
      continue;
    }
    semanticDuplicatesByFindingIndex.set(workItem.findingIndex, duplicate);
  }

  for (const [findingIndex, finding] of findings.entries()) {
    const duplicate =
      exactDuplicatesByFindingIndex.get(findingIndex) ||
      semanticDuplicatesByFindingIndex.get(findingIndex);
    if (duplicate) {
      skipped.push({
        ...finding,
        duplicateReason: duplicate.reason,
        ghsaId: duplicate.advisory.ghsa_id || null,
        htmlUrl: duplicate.advisory.html_url || null,
        state: duplicate.advisory.state || null,
      });
      continue;
    }

    const advisory = await createRepositoryAdvisory({
      apiBaseUrl,
      repo,
      token,
      repositoryName,
      finding,
      advisoryCollaborator,
    });

    created.push({
      ...finding,
      ghsaId: advisory.ghsa_id || null,
      htmlUrl: advisory.html_url || null,
      state: advisory.state || null,
    });
  }

  await appendStepSummary(`Created advisories: ${created.length}`);
  await appendStepSummary(`Skipped as duplicates: ${skipped.length}`);
  await appendStepSummary(
    `Semantic dedupe model failures: ${semanticAudit.skippedBecauseModelFailed.length}`,
  );
  if (semanticAudit.skippedBecauseModelFailed.length > 0) {
    await appendStepSummary(
      `Semantic dedupe skipped for: ${semanticAudit.skippedBecauseModelFailed.join(", ")}`,
    );
  }

  const runUrl = runId ? `${serverUrl}/${repo}/actions/runs/${runId}` : null;
  const subject = `[ALERT] security-review:recent found ${findings.length} vulnerability finding(s) for ${repo}`;

  const textSections = [
    `Repository: ${repo}`,
    `Confirmed findings: ${findings.length}`,
    `Created advisories: ${created.length}`,
    `Skipped as duplicates: ${skipped.length}`,
    `Semantic dedupe model failures: ${semanticAudit.skippedBecauseModelFailed.length}`,
    "",
    "Created advisories:",
    ...(created.length === 0
      ? ["- none"]
      : created.map(
          (finding) =>
            `- [${finding.severity}] ${finding.title}${finding.ghsaId ? ` (${finding.ghsaId})` : ""}${finding.htmlUrl ? ` -> ${finding.htmlUrl}` : ""}`,
        )),
    "",
    "Duplicate advisories:",
    ...(skipped.length === 0
      ? ["- none"]
      : skipped.map(
          (finding) =>
            `- [${finding.severity}] ${finding.title}${finding.ghsaId ? ` (${finding.ghsaId})` : ""}${finding.duplicateReason ? ` [${finding.duplicateReason}]` : ""}${finding.htmlUrl ? ` -> ${finding.htmlUrl}` : ""}`,
        )),
  ];

  if (semanticAudit.skippedBecauseModelFailed.length > 0) {
    textSections.push(
      "",
      "Semantic dedupe model failures:",
      ...semanticAudit.skippedBecauseModelFailed.map((title) => `- ${title}`),
    );
  }

  if (sessionLogLinks.length > 0) {
    textSections.push(
      "",
      "Session log viewer:",
      ...sessionLogLinks.map(({ label, url }) => `- ${label}: ${url}`),
    );
  }

  if (runUrl) {
    textSections.push("", `Workflow run: ${runUrl}`);
  }

  const html = `
<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;line-height:1.5;">
    <h2 style="margin-bottom:12px;">Nightly security review found vulnerabilities</h2>
    <p style="margin:0 0 12px;"><strong>Repository:</strong> ${escapeHtml(repo)}</p>
    <p style="margin:0 0 12px;">
      Confirmed findings: <strong>${findings.length}</strong><br />
      Created advisories: <strong>${created.length}</strong><br />
      Skipped as duplicates: <strong>${skipped.length}</strong><br />
      Semantic dedupe model failures: <strong>${semanticAudit.skippedBecauseModelFailed.length}</strong>
    </p>
    <h3 style="margin:16px 0 8px;">Created advisories</h3>
    <ul style="margin:0 0 16px;padding-left:20px;">
      ${
        created.length === 0
          ? "<li>none</li>"
          : created
              .map(
                (finding) =>
                  `<li><strong>${escapeHtml(finding.severity.toUpperCase())}</strong> ${escapeHtml(finding.title)}${
                    finding.htmlUrl
                      ? ` - <a href="${escapeHtml(finding.htmlUrl)}">${escapeHtml(finding.ghsaId || "view advisory")}</a>`
                      : ""
                  }</li>`,
              )
              .join("")
      }
    </ul>
    <h3 style="margin:16px 0 8px;">Duplicates</h3>
    <ul style="margin:0 0 16px;padding-left:20px;">
      ${
        skipped.length === 0
          ? "<li>none</li>"
          : skipped
              .map(
                (finding) =>
                  `<li><strong>${escapeHtml(finding.severity.toUpperCase())}</strong> ${escapeHtml(finding.title)}${
                    finding.duplicateReason
                      ? ` <em>(${escapeHtml(finding.duplicateReason)})</em>`
                      : ""
                  }${
                    finding.htmlUrl
                      ? ` - <a href="${escapeHtml(finding.htmlUrl)}">${escapeHtml(finding.ghsaId || "existing advisory")}</a>`
                      : ""
                  }</li>`,
              )
              .join("")
      }
    </ul>
    ${
      semanticAudit.skippedBecauseModelFailed.length === 0
        ? ""
        : `
    <h3 style="margin:16px 0 8px;">Semantic dedupe model failures</h3>
    <ul style="margin:0 0 16px;padding-left:20px;">
      ${semanticAudit.skippedBecauseModelFailed
        .map((title) => `<li>${escapeHtml(title)}</li>`)
        .join("")}
    </ul>
    `
    }
    ${
      sessionLogLinks.length > 0
        ? `
    <h3 style="margin:16px 0 8px;">Session log viewer</h3>
    <ul style="margin:0 0 16px;padding-left:20px;">
      ${sessionLogLinks
        .map(
          ({ label, url }) =>
            `<li>${escapeHtml(label)} - <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></li>`,
        )
        .join("")}
    </ul>
    `
        : ""
    }
    ${
      runUrl
        ? `<p style="margin:16px 0 0;">Workflow run: <a href="${escapeHtml(runUrl)}">${escapeHtml(runUrl)}</a></p>`
        : ""
    }
  </body>
</html>
  `.trim();

  await sendMailgunEmail({
    apiKey: mailgunApiKey,
    domain: mailgunDomain,
    from: fromEmail,
    recipients,
    subject,
    text: textSections.join("\n"),
    html,
  });

  console.log(
    `Processed ${findings.length} finding(s): ${created.length} created, ${skipped.length} duplicate(s).`,
  );
};

export {
  advisoryFingerprint,
  advisorySupportsLocalDedupe,
  advisorySupportsSemanticDedupe,
  appendLimited,
  buildCodexExecArgs,
  buildCodexExecEnv,
  buildCreateRepositoryAdvisoryPayload,
  buildSemanticDuplicatePrompt,
  buildSemanticDuplicateWorkItems,
  findingFingerprint,
  findLocalExactDuplicate,
  findSemanticDuplicates,
  normalizeFreeText,
  parseJsonObject,
  parseSemanticDuplicateMatches,
  scoreAdvisorySimilarity,
  tokenizeForSimilarity,
};

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

import fs from "node:fs/promises";
import { spawn } from "node:child_process";

const GITHUB_API_VERSION = "2022-11-28";
const MAILGUN_API_BASE_URL = "https://api.mailgun.net/v3";
const DEFAULT_ADVISORY_COLLABORATOR = "wwwillchen";
const MAX_ADVISORIES_FOR_MODEL = 12;
const MAX_MODEL_TEXT_CHARS = 1200;

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
      .filter((token) => token.length >= 4),
  );

const advisorySupportsSemanticDedupe = (advisory) =>
  ["triage", "draft", "published"].includes(String(advisory?.state || "").toLowerCase());

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
    return JSON.parse(fencedMatch[1]);
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }

  throw new Error("Codex did not return parseable JSON");
};

const runCodexPrompt = async (prompt) =>
  await new Promise((resolve, reject) => {
    const child = spawn("codex", ["exec", "--dangerously-bypass-approvals-and-sandbox", "-"], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(
        new Error(
          `Codex dedupe prompt failed with exit code ${code}: ${stderr.trim().slice(0, 1000)}`,
        ),
      );
    });

    child.stdin.end(prompt);
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
    body: JSON.stringify({
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
      credits: advisoryCollaborator
        ? [
            {
              login: advisoryCollaborator,
              type: "coordinator",
            },
          ]
        : null,
      start_private_fork: false,
    }),
  });

  if (!response.ok) {
    const body = await readResponseBody(response);
    throw new Error(`Failed to create advisory "${finding.title}": ${response.status} ${body}`);
  }

  return response.json();
};

const addRepositoryAdvisoryCollaborator = async ({ apiBaseUrl, repo, ghsaId, token, username }) => {
  if (!ghsaId || !username) {
    return false;
  }

  const putResponse = await fetch(
    `${apiBaseUrl}/repos/${repo}/security-advisories/${encodeURIComponent(ghsaId)}/collaborators/${encodeURIComponent(username)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
    },
  );

  if (putResponse.ok) {
    return true;
  }

  const putBody = await readResponseBody(putResponse);
  console.warn(
    `Unable to add security advisory collaborator via documented-style endpoint for ${ghsaId}: ${putResponse.status} ${putBody}`,
  );
  return false;
};

const findSemanticDuplicate = async ({ finding, advisories }) => {
  const candidates = advisories
    .filter(advisorySupportsSemanticDedupe)
    .map((advisory) => ({
      advisory,
      score: scoreAdvisorySimilarity(finding, advisory),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_ADVISORIES_FOR_MODEL)
    .map(({ advisory }, index) => ({
      candidateIndex: index,
      ghsaId: String(advisory.ghsa_id || ""),
      state: String(advisory.state || ""),
      summary: truncate(String(advisory.summary || "")),
      description: truncate(String(advisory.description || "")),
      advisory,
    }));

  if (candidates.length === 0) {
    return null;
  }

  const prompt = [
    "You are deduplicating GitHub repository security advisories.",
    "Decide whether the proposed finding is the same underlying vulnerability as one existing advisory.",
    "Only mark a duplicate when they describe materially the same vulnerable behavior or exploit path.",
    "Return JSON only with this schema:",
    '{"duplicateIndex":number|null,"confidence":"high"|"low","reason":string}',
    "",
    "Proposed finding:",
    JSON.stringify(
      {
        title: finding.title,
        severity: finding.severity,
        description: truncate(finding.description),
      },
      null,
      2,
    ),
    "",
    "Existing advisories:",
    JSON.stringify(
      candidates.map(({ advisory, ...candidate }) => candidate),
      null,
      2,
    ),
    "",
    "If none are clearly the same vulnerability, set duplicateIndex to null.",
    "If you are uncertain, set confidence to low.",
  ].join("\n");

  let parsed;
  try {
    parsed = parseJsonObject(await runCodexPrompt(prompt));
  } catch (error) {
    console.warn(
      `Codex semantic dedupe failed for "${finding.title}". Proceeding without semantic dedupe. ${String(error)}`,
    );
    return null;
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    parsed.duplicateIndex == null ||
    parsed.confidence !== "high"
  ) {
    return null;
  }

  const match = candidates.find((candidate) => candidate.candidateIndex === parsed.duplicateIndex);
  if (!match) {
    return null;
  }

  return {
    advisory: match.advisory,
    reason: String(parsed.reason || "").trim() || "semantic duplicate",
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
  const created = [];
  const skipped = [];

  for (const finding of findings) {
    const semanticDuplicate = await findSemanticDuplicate({
      finding,
      advisories: existing,
    });
    if (semanticDuplicate) {
      skipped.push({
        ...finding,
        duplicateReason: semanticDuplicate.reason,
        ghsaId: semanticDuplicate.advisory.ghsa_id || null,
        htmlUrl: semanticDuplicate.advisory.html_url || null,
        state: semanticDuplicate.advisory.state || null,
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

    const collaboratorAttached = await addRepositoryAdvisoryCollaborator({
      apiBaseUrl,
      repo,
      ghsaId: advisory.ghsa_id || null,
      token,
      username: advisoryCollaborator,
    });

    created.push({
      ...finding,
      collaboratorAttached,
      ghsaId: advisory.ghsa_id || null,
      htmlUrl: advisory.html_url || null,
      state: advisory.state || null,
    });
    existing.push(advisory);
  }

  await appendStepSummary(`Created advisories: ${created.length}`);
  await appendStepSummary(`Skipped as duplicates: ${skipped.length}`);

  const runUrl = runId ? `${serverUrl}/${repo}/actions/runs/${runId}` : null;
  const subject = `[ALERT] security-review:recent found ${findings.length} vulnerability finding(s) for ${repo}`;

  const textSections = [
    `Repository: ${repo}`,
    `Confirmed findings: ${findings.length}`,
    `Created advisories: ${created.length}`,
    `Skipped as duplicates: ${skipped.length}`,
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
      Skipped as duplicates: <strong>${skipped.length}</strong>
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
                    finding.collaboratorAttached === false
                      ? ` <em>(credit added for ${escapeHtml(advisoryCollaborator)}, collaborator attach needs manual follow-up)</em>`
                      : ""
                  }${
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

await main();

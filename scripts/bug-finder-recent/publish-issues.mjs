import crypto from "node:crypto";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

const GITHUB_API_VERSION = "2022-11-28";
const MAILGUN_API_BASE_URL = "https://api.mailgun.net/v3";
const BUG_LABEL = "bugfinder";
const DO_ISSUE_LABEL = "/do-issue";
const MAX_EXISTING_ISSUE_PAGES = 20;
const REQUIRED_SECTION_HEADINGS = [
  "### Summary",
  "### Affected Files",
  "### Reproduction Path",
  "### Impact",
  "### Suggested Fix",
];
const VALID_CATEGORIES = new Set([
  "data-loss",
  "race-condition",
  "unhandled-error",
  "logic-error",
  "ui-bug",
  "performance",
  "integration",
]);

const readResponseBody = async (response) => {
  const text = await response.text();
  return text.trim().slice(0, 1000);
};

const normalizeTitle = (value) =>
  value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const normalizeDedupKey = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

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
    throw new Error("BUG_FINDER_ALERT_EMAILS must contain at least one address");
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

const findSectionIndexes = (raw) => {
  const indexes = REQUIRED_SECTION_HEADINGS.map((heading) => raw.indexOf(heading));
  if (indexes.some((index) => index === -1)) {
    return null;
  }
  for (let index = 1; index < indexes.length; index += 1) {
    if (indexes[index - 1] >= indexes[index]) {
      return null;
    }
  }
  return indexes;
};

const extractSectionBlock = (raw, startHeading, endHeading) => {
  const startIndex = raw.indexOf(startHeading);
  if (startIndex === -1) {
    return "";
  }
  const contentStart = startIndex + startHeading.length;
  const endIndex = endHeading ? raw.indexOf(endHeading, contentStart) : -1;
  const block = endIndex === -1 ? raw.slice(contentStart) : raw.slice(contentStart, endIndex);
  return block.trim();
};

const parseAffectedFiles = (raw) =>
  extractSectionBlock(raw, "### Affected Files", "### Reproduction Path")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);

export const sanitizeMentions = (value) => value.replaceAll("@", "@\u200b");

export const buildDedupMarker = (dedupKey) => {
  const normalizedKey = normalizeDedupKey(dedupKey);
  const digest = crypto.createHash("sha256").update(normalizedKey).digest("hex").slice(0, 16);
  return `<!-- bug-finder-dedup:${digest}:${normalizedKey} -->`;
};

const readDedupMarker = (issueBody) => {
  const match = String(issueBody || "").match(/<!-- bug-finder-dedup:[0-9a-f]{16}:([a-z0-9-]+) -->/);
  return match ? match[1] : null;
};

export const parseFindingMarkdown = (raw, filePath) => {
  const titleMatch = raw.match(/^#\s+(.+)$/m);
  if (!titleMatch) {
    return { error: `Malformed finding file ${filePath}: missing # title heading` };
  }
  const title = titleMatch[1].trim();

  const severityMatch = raw.match(/^-\s*Severity:\s*(critical|high)\s*$/im);
  if (!severityMatch) {
    return { error: `Malformed finding file ${filePath}: missing or invalid severity line` };
  }
  const severity = severityMatch[1].toLowerCase();

  const categoryMatch = raw.match(/^-\s*Category:\s*(\S+)\s*$/im);
  if (!categoryMatch) {
    return { error: `Malformed finding file ${filePath}: missing category line` };
  }
  const category = categoryMatch[1].toLowerCase();
  if (!VALID_CATEGORIES.has(category)) {
    return { error: `Malformed finding file ${filePath}: invalid category "${category}"` };
  }

  const dedupKeyMatch = raw.match(/^-\s*Dedup Key:\s*([a-z0-9][a-z0-9-]{2,100})\s*$/im);
  if (!dedupKeyMatch) {
    return { error: `Malformed finding file ${filePath}: missing or invalid dedup key line` };
  }
  const dedupKey = normalizeDedupKey(dedupKeyMatch[1]);

  const sectionIndexes = findSectionIndexes(raw);
  if (!sectionIndexes) {
    return {
      error: `Malformed finding file ${filePath}: missing required sections or section order`,
    };
  }
  const description = raw.slice(sectionIndexes[0]).trim();

  if (!description) {
    return { error: `Malformed finding file ${filePath}: empty description` };
  }

  const affectedFiles = parseAffectedFiles(raw);
  if (affectedFiles.length === 0) {
    return { error: `Malformed finding file ${filePath}: missing affected files list` };
  }

  return {
    finding: {
      title: title.slice(0, 256),
      description,
      severity,
      category,
      dedupKey,
      affectedFiles,
    },
  };
};

export const loadFindings = async (dirPath) => {
  let entries;
  try {
    entries = await fs.readdir(dirPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { findings: [], malformed: [] };
    }
    throw error;
  }

  const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();
  const findings = [];
  const malformed = [];

  for (const file of mdFiles) {
    const filePath = `${dirPath}/${file}`;
    const raw = (await fs.readFile(filePath, "utf8")).trim();
    if (!raw) {
      malformed.push(`Malformed finding file ${filePath}: empty file`);
      continue;
    }
    const parsed = parseFindingMarkdown(raw, filePath);
    if (parsed.error) {
      malformed.push(parsed.error);
      continue;
    }
    findings.push(parsed.finding);
  }

  return { findings, malformed };
};

const ensureLabel = async ({ apiBaseUrl, repo, token, label, description }) => {
  const response = await fetch(`${apiBaseUrl}/repos/${repo}/labels/${encodeURIComponent(label)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
  });

  if (response.ok) {
    return;
  }

  if (response.status !== 404) {
    const body = await readResponseBody(response);
    throw new Error(`Failed to check label "${label}": ${response.status} ${body}`);
  }

  const createResponse = await fetch(`${apiBaseUrl}/repos/${repo}/labels`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: label,
      color: "d73a4a",
      description,
    }),
  });

  if (!createResponse.ok) {
    const body = await readResponseBody(createResponse);
    throw new Error(`Failed to create label "${label}": ${createResponse.status} ${body}`);
  }
};

const fetchExistingIssues = async ({ apiBaseUrl, repo, token }) => {
  let nextUrl = new URL(`${apiBaseUrl}/repos/${repo}/issues`);
  nextUrl.searchParams.set("labels", BUG_LABEL);
  nextUrl.searchParams.set("state", "open");
  nextUrl.searchParams.set("per_page", "100");

  const issues = [];
  let pageCount = 0;
  while (nextUrl && pageCount < MAX_EXISTING_ISSUE_PAGES) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
    });

    if (!response.ok) {
      const body = await readResponseBody(response);
      throw new Error(
        `Failed to list repository issues: ${response.status} ${body}`,
      );
    }

    const page = await response.json();
    if (!Array.isArray(page)) {
      throw new Error("Unexpected issue list response shape");
    }
    issues.push(...page);
    const nextPage = getNextPageUrl(response.headers.get("link"));
    nextUrl = nextPage ? new URL(nextPage) : null;
    pageCount += 1;
  }

  return { issues, reachedPageCap: pageCount >= MAX_EXISTING_ISSUE_PAGES && Boolean(nextUrl) };
};

export const createRepositoryIssue = async ({
  apiBaseUrl,
  repo,
  token,
  finding,
  agentLabel,
}) => {
  const safeTitle = sanitizeMentions(finding.title);
  const safeDescription = sanitizeMentions(finding.description);
  const dedupMarker = buildDedupMarker(finding.dedupKey);
  const body = [
    `**Severity:** ${finding.severity}`,
    `**Category:** ${finding.category}`,
    "",
    safeDescription,
    "",
    "---",
    `This issue was generated by the nightly \`bug-finder:recent\` workflow (agent: ${agentLabel}).`,
    dedupMarker,
  ].join("\n");

  const response = await fetch(`${apiBaseUrl}/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: `[${finding.severity.toUpperCase()}] ${safeTitle}`,
      body,
      labels: [BUG_LABEL, DO_ISSUE_LABEL],
    }),
  });

  if (!response.ok) {
    const responseBody = await readResponseBody(response);
    throw new Error(`Failed to create issue "${finding.title}": ${response.status} ${responseBody}`);
  }

  return response.json();
};

const sendMailgunEmail = async ({
  apiKey,
  domain,
  from,
  recipients,
  subject,
  text,
  html,
}) => {
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
    const responseBody = await readResponseBody(response);
    throw new Error(`Failed to send Mailgun alert: ${response.status} ${responseBody}`);
  }
};

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const main = async () => {
  const findingsDir = process.env.FINDINGS_DIR?.trim() || "out-bug-finder/findings";
  const { findings, malformed } = await loadFindings(findingsDir);

  await appendStepSummary(`Findings reviewed: ${findings.length}`);
  await appendStepSummary(`Malformed finding files: ${malformed.length}`);

  if (findings.length === 0) {
    console.log("No confirmed critical/high bugs to file.");
    await appendStepSummary("Created issues: 0");
    if (malformed.length > 0) {
      throw new Error(malformed.join("\n"));
    }
    return;
  }

  const token = requireEnv("BUG_FINDER_GITHUB_TOKEN");
  const repo = requireEnv("GITHUB_REPOSITORY");
  const recipients = parseRecipients(requireEnv("BUG_FINDER_ALERT_EMAILS"));
  const mailgunApiKey = requireEnv("MAILGUN_API_KEY");
  const mailgunDomain = requireEnv("MAILGUN_DOMAIN");
  const fromEmail = requireEnv("MAILGUN_FROM_EMAIL");
  const apiBaseUrl = process.env.GITHUB_API_URL?.trim() || "https://api.github.com";
  const serverUrl = process.env.GITHUB_SERVER_URL?.trim() || "https://github.com";
  const runId = process.env.GITHUB_RUN_ID?.trim();
  const agentKind = process.env.AGENT_KIND?.trim() || "codex";
  const agentLabel = agentKind === "claude" ? "Claude" : "Codex";
  const sessionLogLinks = await loadSessionLogLinks(process.env.SESSION_LOG_COMMENT_PATH?.trim());

  await ensureLabel({
    apiBaseUrl,
    repo,
    token,
    label: BUG_LABEL,
    description: "Bug found by the nightly bug-finder:recent workflow",
  });
  await ensureLabel({
    apiBaseUrl,
    repo,
    token,
    label: DO_ISSUE_LABEL,
    description: "Kick off the issue-to-PR workflow for this issue",
  });

  const { issues: existing, reachedPageCap } = await fetchExistingIssues({ apiBaseUrl, repo, token });
  const existingByDedupKey = new Map(
    existing
      .map((issue) => [readDedupMarker(issue.body), issue])
      .filter(([dedupKey]) => dedupKey),
  );
  const existingByTitle = new Map(
    existing.map((issue) => [normalizeTitle(String(issue.title || "")), issue]).filter(([title]) => title),
  );

  const created = [];
  const skipped = [];
  const failed = [];

  for (const finding of findings) {
    const titleKey = normalizeTitle(`[${finding.severity.toUpperCase()}] ${sanitizeMentions(finding.title)}`);
    const dedupKey = normalizeDedupKey(finding.dedupKey);
    const duplicate = existingByDedupKey.get(dedupKey) || existingByTitle.get(titleKey);
    if (duplicate) {
      skipped.push({
        ...finding,
        issueNumber: duplicate.number || null,
        htmlUrl: duplicate.html_url || null,
        state: duplicate.state || null,
      });
      continue;
    }

    try {
      const issue = await createRepositoryIssue({
        apiBaseUrl,
        repo,
        token,
        finding,
        agentLabel,
      });
      created.push({
        ...finding,
        issueNumber: issue.number || null,
        htmlUrl: issue.html_url || null,
        state: issue.state || null,
      });
      existingByDedupKey.set(dedupKey, issue);
      existingByTitle.set(titleKey, issue);
    } catch (error) {
      failed.push({
        ...finding,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await appendStepSummary(`Created issues: ${created.length}`);
  await appendStepSummary(`Skipped as duplicates: ${skipped.length}`);
  await appendStepSummary(`Issue creation failures: ${failed.length}`);
  if (reachedPageCap) {
    await appendStepSummary(
      `Stopped duplicate scan after ${MAX_EXISTING_ISSUE_PAGES} pages of open bugfinder issues.`,
    );
  }
  if (malformed.length > 0) {
    await appendStepSummary("Malformed findings:");
    for (const message of malformed) {
      await appendStepSummary(`- ${message}`);
    }
  }
  if (failed.length > 0) {
    await appendStepSummary("Issue creation failures:");
    for (const entry of failed) {
      await appendStepSummary(`- ${entry.title}: ${entry.error}`);
    }
  }

  const runUrl = runId ? `${serverUrl}/${repo}/actions/runs/${runId}` : null;
  const subject = `[ALERT] bug-finder:recent (${agentLabel}) found ${findings.length} bug(s) for ${repo}`;

  const textSections = [
    `Repository: ${repo}`,
    `Agent: ${agentLabel}`,
    `Confirmed findings: ${findings.length}`,
    `Created issues: ${created.length}`,
    `Skipped as duplicates: ${skipped.length}`,
    "",
    "Created issues:",
    ...(created.length === 0
      ? ["- none"]
      : created.map(
          (finding) =>
            `- [${finding.severity}] ${finding.title} (#${finding.issueNumber})${finding.htmlUrl ? ` -> ${finding.htmlUrl}` : ""}`,
        )),
    "",
    "Duplicate issues:",
    ...(skipped.length === 0
      ? ["- none"]
      : skipped.map(
          (finding) =>
            `- [${finding.severity}] ${finding.title} (#${finding.issueNumber})${finding.htmlUrl ? ` -> ${finding.htmlUrl}` : ""}`,
        )),
    "",
    "Issue creation failures:",
    ...(failed.length === 0
      ? ["- none"]
      : failed.map((finding) => `- [${finding.severity}] ${finding.title}: ${finding.error}`)),
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
  if (reachedPageCap) {
    textSections.push(
      "",
      `Duplicate scan hit the safety cap of ${MAX_EXISTING_ISSUE_PAGES} pages of open bugfinder issues.`,
    );
  }

  const html = `
<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;line-height:1.5;">
    <h2 style="margin-bottom:12px;">Nightly bug finder found issues</h2>
    <p style="margin:0 0 12px;"><strong>Repository:</strong> ${escapeHtml(repo)}</p>
    <p style="margin:0 0 12px;"><strong>Agent:</strong> ${escapeHtml(agentLabel)}</p>
    <p style="margin:0 0 12px;">
      Confirmed findings: <strong>${findings.length}</strong><br />
      Created issues: <strong>${created.length}</strong><br />
      Skipped as duplicates: <strong>${skipped.length}</strong><br />
      Issue creation failures: <strong>${failed.length}</strong>
    </p>
    <h3 style="margin:16px 0 8px;">Created issues</h3>
    <ul style="margin:0 0 16px;padding-left:20px;">
      ${
        created.length === 0
          ? "<li>none</li>"
          : created
              .map(
                (finding) =>
                  `<li><strong>${escapeHtml(finding.severity.toUpperCase())}</strong> ${escapeHtml(finding.title)}${
                    finding.htmlUrl
                      ? ` - <a href="${escapeHtml(finding.htmlUrl)}">#${finding.issueNumber}</a>`
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
                    finding.htmlUrl
                      ? ` - <a href="${escapeHtml(finding.htmlUrl)}">#${finding.issueNumber}</a>`
                      : ""
                  }</li>`,
              )
              .join("")
      }
    </ul>
    <h3 style="margin:16px 0 8px;">Issue creation failures</h3>
    <ul style="margin:0 0 16px;padding-left:20px;">
      ${
        failed.length === 0
          ? "<li>none</li>"
          : failed
              .map(
                (finding) =>
                  `<li><strong>${escapeHtml(finding.severity.toUpperCase())}</strong> ${escapeHtml(finding.title)}: ${escapeHtml(finding.error)}</li>`,
              )
              .join("")
      }
    </ul>
    ${
      reachedPageCap
        ? `<p style="margin:16px 0 0;">Duplicate scan hit the safety cap of ${MAX_EXISTING_ISSUE_PAGES} pages of open bugfinder issues.</p>`
        : ""
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
    `Processed ${findings.length} finding(s): ${created.length} created, ${skipped.length} duplicate(s), ${failed.length} failed.`,
  );

  const terminalErrors = [...malformed, ...failed.map((entry) => entry.error)];
  if (terminalErrors.length > 0) {
    throw new Error(terminalErrors.join("\n"));
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

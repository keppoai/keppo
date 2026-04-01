import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

const GITHUB_API_VERSION = "2022-11-28";
const MAILGUN_API_BASE_URL = "https://api.mailgun.net/v3";

const readResponseBody = async (response) => {
  const text = await response.text();
  return text.trim().slice(0, 1000);
};

const normalizeSummary = (value) =>
  value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

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

  // Description is everything after the frontmatter (title + severity lines)
  const summaryIndex = raw.indexOf("### Summary");
  const description = summaryIndex !== -1
    ? raw.slice(summaryIndex).trim()
    : raw.slice(raw.indexOf("\n", raw.indexOf(severityMatch[0]) + severityMatch[0].length)).trim();

  if (!description) {
    return { error: `Malformed finding file ${filePath}: empty description` };
  }

  return {
    finding: {
      title: title.slice(0, 256),
      description,
      severity,
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
      throw new Error(
        `Failed to list repository security advisories: ${response.status} ${body}`,
      );
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
      start_private_fork: false,
    }),
  });

  if (!response.ok) {
    const body = await readResponseBody(response);
    throw new Error(`Failed to create advisory "${finding.title}": ${response.status} ${body}`);
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

export const main = async () => {
  const findingsDir = process.env.FINDINGS_DIR?.trim() || "out-security-review/findings";
  const { findings, malformed } = await loadFindings(findingsDir);

  await appendStepSummary(`Findings reviewed: ${findings.length}`);
  await appendStepSummary(`Malformed finding files: ${malformed.length}`);

  if (findings.length === 0) {
    console.log("No confirmed critical/high vulnerabilities to file.");
    await appendStepSummary("Created advisories: 0");
    if (malformed.length > 0) {
      throw new Error(malformed.join("\n"));
    }
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
  const sessionLogLinks = await loadSessionLogLinks(process.env.SESSION_LOG_COMMENT_PATH?.trim());

  const existing = await fetchExistingAdvisories({ apiBaseUrl, repo, token });
  const existingBySummary = new Map(
    existing
      .map((advisory) => [normalizeSummary(String(advisory.summary || "")), advisory])
      .filter(([summary]) => summary),
  );

  const created = [];
  const skipped = [];

  for (const finding of findings) {
    const key = normalizeSummary(finding.title);
    const duplicate = existingBySummary.get(key);
    if (duplicate) {
      skipped.push({
        ...finding,
        ghsaId: duplicate.ghsa_id || null,
        htmlUrl: duplicate.html_url || null,
        state: duplicate.state || null,
      });
      continue;
    }

    const advisory = await createRepositoryAdvisory({
      apiBaseUrl,
      repo,
      token,
      repositoryName,
      finding,
    });
    created.push({
      ...finding,
      ghsaId: advisory.ghsa_id || null,
      htmlUrl: advisory.html_url || null,
      state: advisory.state || null,
    });
    existingBySummary.set(key, advisory);
  }

  await appendStepSummary(`Created advisories: ${created.length}`);
  await appendStepSummary(`Skipped as duplicates: ${skipped.length}`);
  if (malformed.length > 0) {
    await appendStepSummary("Malformed findings:");
    for (const message of malformed) {
      await appendStepSummary(`- ${message}`);
    }
  }

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
            `- [${finding.severity}] ${finding.title}${finding.ghsaId ? ` (${finding.ghsaId})` : ""}${finding.htmlUrl ? ` -> ${finding.htmlUrl}` : ""}`,
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

  if (malformed.length > 0) {
    throw new Error(malformed.join("\n"));
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

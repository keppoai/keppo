import { describe, expect, it } from "vitest";
import {
  advisorySupportsSemanticDedupe,
  buildCodexExecArgs,
  buildCodexExecEnv,
  buildCreateRepositoryAdvisoryPayload,
  buildSemanticDuplicateWorkItems,
  findLocalExactDuplicate,
  parseJsonObject,
  parseSemanticDuplicateMatches,
  tokenizeForSimilarity,
} from "../../scripts/security-review-recent/publish-advisories.mjs";

describe("scripts/security-review-recent/publish-advisories.mjs", () => {
  it("keeps 3-letter security acronyms in similarity tokenization", () => {
    expect(Array.from(tokenizeForSimilarity("XSS SQL RCE XXE SSRF overflow"))).toEqual([
      "xss",
      "sql",
      "rce",
      "xxe",
      "ssrf",
      "overflow",
    ]);
  });

  it("falls through malformed fenced JSON to brace extraction", () => {
    const value = [
      "Model commentary first",
      "```json",
      '{"duplicateIndex": }',
      "```",
      '{"duplicateIndex":1,"confidence":"high","reason":"same root cause"}',
    ].join("\n");

    expect(parseJsonObject(value)).toEqual({
      duplicateIndex: 1,
      confidence: "high",
      reason: "same root cause",
    });
  });

  it("uses sandboxed Codex exec args and disables websocket transport", () => {
    expect(buildCodexExecArgs()).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--disable",
      "responses_websockets",
      "-",
    ]);
  });

  it("passes only an allowlisted environment to the Codex subprocess", () => {
    expect(
      buildCodexExecEnv({
        PATH: "/usr/bin",
        HOME: "/tmp/home",
        OPENAI_API_KEY: "sk-test",
        SECURITY_ADVISORY_TOKEN: "ghs-secret",
        MAILGUN_API_KEY: "mail-secret",
      }),
    ).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      OPENAI_API_KEY: "sk-test",
    });
  });

  it("omits advisory credits when no collaborator is configured", () => {
    expect(
      buildCreateRepositoryAdvisoryPayload({
        repositoryName: "keppo",
        finding: {
          title: "SQL injection in widget route",
          description: "Unsanitized input reaches the query builder.",
          severity: "high",
        },
        advisoryCollaborator: "",
      }),
    ).not.toHaveProperty("credits");
  });

  it("keeps unpublished advisories out of semantic model candidates", () => {
    const workItems = buildSemanticDuplicateWorkItems({
      findings: [
        {
          title: "draft advisory match",
          description: "Same underlying issue",
          severity: "high",
        },
      ],
      advisories: [
        {
          ghsa_id: "GHSA-draft",
          state: "draft",
          summary: "draft advisory match",
          description: "Same underlying issue",
        },
        {
          ghsa_id: "GHSA-published",
          state: "published",
          summary: "draft advisory match",
          description: "Same underlying issue",
        },
      ],
    });

    expect(workItems).toHaveLength(1);
    expect(advisorySupportsSemanticDedupe({ state: "draft" })).toBe(false);
    expect(advisorySupportsSemanticDedupe({ state: "published" })).toBe(true);
    expect(workItems[0]?.candidates.map((candidate) => candidate.ghsaId)).toEqual([
      "GHSA-published",
    ]);
  });

  it("uses local exact dedupe for unpublished advisories", () => {
    expect(
      findLocalExactDuplicate({
        finding: {
          title: "Server-side request forgery in webhook import",
          description: "The webhook import path fetches attacker-controlled URLs.",
          severity: "high",
        },
        advisories: [
          {
            ghsa_id: "GHSA-private",
            state: "triage",
            summary: "Server-side request forgery in webhook import",
            description: "The webhook import path fetches attacker-controlled URLs.",
          },
        ],
      }),
    ).toMatchObject({
      advisory: {
        ghsa_id: "GHSA-private",
      },
      reason: "exact duplicate of existing advisory",
    });
  });

  it("ignores model matches with invalid duplicate indexes", () => {
    const workItems = buildSemanticDuplicateWorkItems({
      findings: [
        {
          title: "published advisory match",
          description: "Same issue",
          severity: "high",
        },
      ],
      advisories: [
        {
          ghsa_id: "GHSA-published",
          state: "published",
          summary: "published advisory match",
          description: "Same issue",
        },
      ],
    });

    expect(
      parseSemanticDuplicateMatches(
        {
          matches: [
            {
              findingIndex: 0,
              duplicateIndex: 4,
              confidence: "high",
              reason: "hallucinated index",
            },
          ],
        },
        workItems,
      ),
    ).toEqual([]);
  });
});

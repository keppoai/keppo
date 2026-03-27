import { describe, expect, it } from "vitest";
import {
  normalizeMermaidContent,
  splitAutomationDescription,
  validateMermaidContent,
} from "./automation-mermaid";

describe("automation-mermaid", () => {
  it("extracts legacy mermaid fences from the description body", () => {
    const parts = splitAutomationDescription(
      "Daily review workflow\n\n```mermaid\nflowchart TD\nA-->B\n```\n\nNotes for operators",
      null,
    );

    expect(parts.description).toBe("Daily review workflow\n\nNotes for operators");
    expect(parts.mermaidContent).toBe("flowchart TD\nA-->B");
  });

  it("prefers dedicated mermaid content when present", () => {
    const parts = splitAutomationDescription(
      "Daily review workflow",
      "flowchart TD\nStart-->Finish",
    );

    expect(parts.description).toBe("Daily review workflow");
    expect(parts.mermaidContent).toBe("flowchart TD\nStart-->Finish");
  });

  it("rejects invalid mermaid syntax with a validation message", async () => {
    const message = await validateMermaidContent("not valid mermaid syntax");

    expect(message).toEqual(expect.any(String));
  });

  it("auto-quotes flowchart square node labels for lenient parsing", async () => {
    const source = [
      "flowchart TD",
      "  A[Schedule Trigger: 9:00 AM daily] --> B[search_tools: discover available GitHub/Gmail/state tools]",
      "  B --> C[execute_code: compute time window (last_success or 24h, max 7d)]",
    ].join("\n");

    const normalized = normalizeMermaidContent(source);

    expect(normalized).toContain('A["Schedule Trigger: 9:00 AM daily"]');
    expect(normalized).toContain('B["search_tools: discover available GitHub/Gmail/state tools"]');
    expect(normalized).toContain(
      'C["execute_code: compute time window (last_success or 24h, max 7d)"]',
    );
  });

  it("normalizes decision nodes with spaced quoted labels", () => {
    const source = [
      "flowchart TD",
      '  B --> C{ "GitHub + Gmail tools available?" }',
      '  C -->|"No"| D["Stop and report blocked"]',
    ].join("\n");

    const normalized = normalizeMermaidContent(source);

    expect(normalized).toContain('C{"GitHub + Gmail tools available?"}');
  });

  it("accepts valid mermaid syntax", async () => {
    await expect(validateMermaidContent("flowchart TD\nA-->B")).resolves.toBeNull();
  });
});

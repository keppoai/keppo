import { describe, expect, it } from "vitest";
import { source } from "./source.test-fixture";

describe("docs source", () => {
  it("resolves the public docs audiences as top-level sections", () => {
    const tree = source.getPageTree();
    const childNames = tree.children.map((child) => child.name);

    expect(childNames).toContain("User Guide");
    expect(childNames).toContain("Self-Hosted");
    expect(childNames).toContain("Contributors");
  });

  it("resolves article pages by slug", () => {
    const page = source.getPage(["user-guide", "getting-started"]);

    expect(page?.url).toBe("/docs/user-guide/getting-started");
    expect(page?.data.title).toBe("Getting Started");
  });
});

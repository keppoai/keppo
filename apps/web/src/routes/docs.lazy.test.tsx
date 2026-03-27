import { screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderDashboard } from "@/test/render-dashboard";

vi.mock("@/lib/docs/source", async () => {
  return await import("@/lib/docs/source.test-fixture");
});

vi.mock("fumadocs-ui/layouts/docs", () => {
  return {
    DocsLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

let DocsHomePage: typeof import("./docs.lazy").DocsHomePage;

beforeAll(async () => {
  ({ DocsHomePage } = await import("./docs.lazy"));
});

const expectLinkWithHref = (href: string): void => {
  const link = screen
    .getAllByRole("link")
    .find((candidate) => candidate.getAttribute("href") === href);

  expect(link).toBeTruthy();
};

describe("DocsHomePage", () => {
  it("routes visitors into the three public docs audiences", async () => {
    renderDashboard(<DocsHomePage />, {
      route: "/docs",
    });

    expect(
      await screen.findByText("Public docs for operators, self-hosters, and contributors."),
    ).toBeInTheDocument();
    expectLinkWithHref("/docs/user-guide");
    expectLinkWithHref("/docs/self-hosted");
    expectLinkWithHref("/docs/contributors");
  });
});

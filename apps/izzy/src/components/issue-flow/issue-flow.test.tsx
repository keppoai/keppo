import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IssueFlow } from "./issue-flow";

describe("IssueFlow", () => {
  it("renders the signed-out state", () => {
    render(
      <IssueFlow
        authError={null}
        githubLogin={null}
        initialAction="plan"
        initialAgents={["codex"]}
      />,
    );

    expect(screen.getByText("Sign in to get started")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with GitHub" })).toBeInTheDocument();
  });

  it("renders the prompt step for signed-in users", () => {
    render(
      <IssueFlow
        authError={null}
        githubLogin="will"
        initialAction="do"
        initialAgents={["codex"]}
      />,
    );

    expect(screen.getByText("What do you need?")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Describe the problem and what you want done…"),
    ).toBeInTheDocument();
  });
});

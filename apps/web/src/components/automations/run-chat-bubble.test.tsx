import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RunChatBubble } from "./run-chat-bubble";
import type { RunEvent } from "@/lib/automations-view-model";

const createToolCallEvent = (
  overrides: Partial<Extract<RunEvent, { type: "tool_call" }>> = {},
): Extract<RunEvent, { type: "tool_call" }> => ({
  type: "tool_call",
  toolName: "execute_code",
  args: {
    description: "Load recent Gmail threads and print a compact summary.",
    code: [
      'const threads = await gmail.searchThreads({ query: "label:important" });',
      "console.log(threads.length);",
    ].join("\n"),
  },
  status: "success",
  durationMs: 45,
  seq: 1,
  timestamp: "2026-03-07T00:00:00.000Z",
  lastSeq: 1,
  lastTimestamp: "2026-03-07T00:00:00.000Z",
  debugLines: [],
  ...overrides,
});

describe("RunChatBubble", () => {
  it("renders execute_code as a dedicated expandable code card", async () => {
    const user = userEvent.setup();
    render(<RunChatBubble event={createToolCallEvent()} />);

    expect(screen.getByText("Execute code")).toBeInTheDocument();
    expect(
      screen.getByText("Load recent Gmail threads and print a compact summary."),
    ).toBeInTheDocument();
    expect(screen.getByText("2 lines of JavaScript")).toBeInTheDocument();
    expect(screen.queryByText("Arguments")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'const threads = await gmail.searchThreads({ query: "label:important" });',
      ),
    ).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", {
      name: "Show code for: Load recent Gmail threads and print a compact summary.",
    });
    expect(toggle).toBeInTheDocument();

    await user.click(toggle);

    const codeBlock = screen.getByText(
      (_content, node) =>
        node?.tagName.toLowerCase() === "code" &&
        node.textContent?.includes(
          'const threads = await gmail.searchThreads({ query: "label:important" });',
        ) === true,
    );
    expect(codeBlock).toBeVisible();
    expect(codeBlock).toHaveTextContent("console.log(threads.length);");
    expect(codeBlock.closest("pre")).toHaveClass("max-h-80");
    expect(
      screen.getByRole("button", {
        name: "Hide code for: Load recent Gmail threads and print a compact summary.",
      }),
    ).toBeInTheDocument();
  });

  it("falls back to a generic summary when historical runs lack a description", () => {
    render(
      <RunChatBubble
        event={createToolCallEvent({
          args: {
            code: 'console.log("hello");',
          },
        })}
      />,
    );

    expect(screen.getByText("Executed code")).toBeInTheDocument();
  });
});

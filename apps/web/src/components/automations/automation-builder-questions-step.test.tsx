import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AutomationBuilderQuestionsStep } from "./automation-builder-questions-step";

describe("AutomationBuilderQuestionsStep", () => {
  it("does not hijack Enter on interactive controls", async () => {
    const onContinue = vi.fn();
    const onBack = vi.fn();
    render(
      <AutomationBuilderQuestionsStep
        question={{
          id: "delivery_target",
          label: "Where should the summary go?",
          input_type: "radio",
          required: true,
          options: [
            { value: "team_chat", label: "Team chat" },
            { value: "inbox", label: "Inbox" },
          ],
        }}
        questionIndex={1}
        questionCount={2}
        currentValue="team_chat"
        inlineMessage={null}
        inlineMessageTone="muted"
        onAnswerChange={vi.fn()}
        onBack={onBack}
        onContinue={onContinue}
        onJumpToQuestion={vi.fn()}
        questionStates={[
          { id: "delivery_target", answered: true, active: false },
          { id: "schedule", answered: false, active: true },
        ]}
      />,
    );

    const user = userEvent.setup();
    const backButton = screen.getByRole("button", { name: "Back" });
    backButton.focus();
    await user.keyboard("{Enter}");

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("uses semantic checkbox roles and dynamic keyboard hints", () => {
    render(
      <AutomationBuilderQuestionsStep
        question={{
          id: "channels",
          label: "Which channels should receive updates?",
          input_type: "checkbox",
          required: true,
          options: [
            { value: "team_chat", label: "Team chat" },
            { value: "inbox", label: "Inbox" },
          ],
        }}
        questionIndex={0}
        questionCount={2}
        currentValue={["team_chat"]}
        inlineMessage="Answer every required question before generating the draft."
        inlineMessageTone="error"
        onAnswerChange={vi.fn()}
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onJumpToQuestion={vi.fn()}
        questionStates={[
          { id: "channels", answered: true, active: true },
          { id: "schedule", answered: false, active: false },
        ]}
      />,
    );

    expect(
      screen.getByRole("group", { name: "Which channels should receive updates?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Team chat/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("1-2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit brief" })).toBeInTheDocument();
    expect(
      screen.getByText("Answer every required question before generating the draft."),
    ).toBeInTheDocument();
  });
});

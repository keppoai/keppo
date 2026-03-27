"use client";

import React, { useState, useEffect, useCallback, useTransition } from "react";
import type { DraftResponse, QuestionsResponse, UploadedImage } from "@/lib/contracts";
import {
  createIssue,
  IzzyApiError,
  requestClarificationQuestions,
  requestIssueDraft,
  uploadImage,
} from "@/lib/api";
import type { AgentChoice, IssueAction } from "@/lib/labels";
import { buildIssueLabels } from "@/lib/labels";
import { AppHeader } from "@/components/auth-panel";
import { UserFacingError, type ErrorPayload } from "@/components/user-facing-error";
import { PromptStep } from "./prompt-step";
import { QuestionsStep } from "./questions-step";
import { DraftStep } from "./draft-step";
import { LoadingSkeleton } from "./loading-skeleton";

type Step = 1 | 2 | 3;
type UiError = ErrorPayload;
type ErrorStage = "global" | "questions" | "draft" | "create" | "upload";

const toUiError = (error: unknown): UiError => {
  if (error instanceof IzzyApiError) {
    const payload = error.payload as { error?: Partial<UiError> } | null;
    if (payload?.error?.code && payload.error.title && payload.error.summary) {
      return {
        code: payload.error.code,
        title: payload.error.title,
        summary: payload.error.summary,
        nextSteps: payload.error.nextSteps ?? [],
        technicalDetails: payload.error.technicalDetails ?? null,
      };
    }
  }
  return {
    code: "unexpected_error",
    title: "Something went wrong",
    summary: "Izzy could not complete that request.",
    nextSteps: ["Try again."],
    technicalDetails: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  };
};

export function IssueFlow(props: {
  githubLogin: string | null;
  initialAction: IssueAction;
  initialAgents: AgentChoice[];
  authError: string | null;
  previewSeed?: {
    prompt: string;
    questions: QuestionsResponse["questions"];
    answers: Record<string, string | string[]>;
    draft: DraftResponse | null;
  } | null;
}) {
  const [activeStep, setActiveStep] = useState<Step>(
    props.previewSeed?.draft ? 3 : props.previewSeed?.questions?.length ? 2 : 1,
  );
  const [prompt, setPrompt] = useState(props.previewSeed?.prompt ?? "");
  const [action, setAction] = useState<IssueAction>(props.initialAction);
  const [agents, setAgents] = useState<AgentChoice[]>(props.initialAgents);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [questions, setQuestions] = useState<QuestionsResponse["questions"]>(
    props.previewSeed?.questions ?? [],
  );
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(
    props.previewSeed?.answers ?? {},
  );
  const [draft, setDraft] = useState<DraftResponse | null>(props.previewSeed?.draft ?? null);
  const [title, setTitle] = useState(props.previewSeed?.draft?.draft.title ?? "");
  const [body, setBody] = useState(props.previewSeed?.draft?.bodyMarkdown ?? "");
  const [selectedLabels, setSelectedLabels] = useState<string[]>(
    props.previewSeed?.draft?.selectedLabels ?? buildIssueLabels(action, agents),
  );
  const [issueUrl, setIssueUrl] = useState<string | null>(null);
  const [error, setError] = useState<UiError | null>(
    props.authError === "github_not_allowed"
      ? {
          code: "github_not_allowed",
          title: "GitHub access is restricted",
          summary: "Your GitHub account is not on the Izzy allowlist.",
          nextSteps: [
            "Use an approved GitHub account.",
            "Ask a maintainer to update the allowlist if needed.",
          ],
          technicalDetails: null,
        }
      : null,
  );
  const [errorStage, setErrorStage] = useState<ErrorStage | null>(
    props.authError === "github_not_allowed" ? "global" : null,
  );
  const [isUploading, startUploadTransition] = useTransition();
  const [isGeneratingQuestions, startQuestionsTransition] = useTransition();
  const [isGeneratingDraft, startDraftTransition] = useTransition();
  const [isCreatingIssue, startCreateTransition] = useTransition();

  const isLoading = isGeneratingQuestions || isGeneratingDraft;

  const handleAgentToggle = useCallback(
    (agent: AgentChoice) => {
      const nextAgents = agents.includes(agent)
        ? agents.filter((entry) => entry !== agent)
        : [...agents, agent];
      const finalAgents = nextAgents.length > 0 ? nextAgents : agents;
      setAgents(finalAgents);
      const workflowLabels = buildIssueLabels(action, finalAgents);
      setSelectedLabels((current) => {
        const extras = current.filter(
          (label) =>
            !label.startsWith("/plan-issue") &&
            !label.startsWith("/do-issue") &&
            !label.startsWith("?agent:"),
        );
        return [...workflowLabels, ...extras];
      });
    },
    [agents, action],
  );

  const handleActionChange = useCallback(
    (nextAction: IssueAction) => {
      setAction(nextAction);
      const workflowLabels = buildIssueLabels(nextAction, agents);
      setSelectedLabels((current) => {
        const extras = current.filter(
          (label) =>
            !label.startsWith("/plan-issue") &&
            !label.startsWith("/do-issue") &&
            !label.startsWith("?agent:"),
        );
        return [...workflowLabels, ...extras];
      });
    },
    [agents],
  );

  const handleContinueFromPrompt = useCallback(() => {
    setBody("");
    setTitle("");
    setDraft(null);
    setIssueUrl(null);
    setQuestions([]);
    setAnswers({});
    setActiveStep(2);
    startQuestionsTransition(async () => {
      setError(null);
      setErrorStage(null);
      try {
        const response = await requestClarificationQuestions({
          prompt,
          action,
          agents,
          images,
        });
        setQuestions(response.questions);
        if (response.questions.length === 0) {
          setAnswers({});
          setActiveStep(3);
          startDraftTransition(async () => {
            try {
              const draftResponse = await requestIssueDraft({
                prompt,
                action,
                agents,
                images,
                answers: {},
              });
              setDraft(draftResponse);
              setTitle(draftResponse.draft.title);
              setBody(draftResponse.bodyMarkdown);
              setSelectedLabels(draftResponse.selectedLabels);
              setIssueUrl(null);
            } catch (err) {
              setError(toUiError(err));
              setErrorStage("draft");
              setActiveStep(1);
            }
          });
        }
      } catch (err) {
        setError(toUiError(err));
        setErrorStage("questions");
        setActiveStep(1);
      }
    });
  }, [prompt, action, agents, images]);

  const handleContinueFromQuestions = useCallback(() => {
    setActiveStep(3);
    startDraftTransition(async () => {
      setError(null);
      setErrorStage(null);
      try {
        const response = await requestIssueDraft({
          prompt,
          action,
          agents,
          images,
          answers,
        });
        setDraft(response);
        setTitle(response.draft.title);
        setBody(response.bodyMarkdown);
        setSelectedLabels(response.selectedLabels);
        setIssueUrl(null);
      } catch (err) {
        setError(toUiError(err));
        setErrorStage("draft");
        setActiveStep(2);
      }
    });
  }, [prompt, action, agents, images, answers]);

  const handleCreateIssue = useCallback(() => {
    startCreateTransition(async () => {
      setError(null);
      setErrorStage(null);
      try {
        const response = await createIssue({
          title,
          body,
          labels: selectedLabels,
        });
        setIssueUrl(response.issueUrl);
      } catch (err) {
        setError(toUiError(err));
        setErrorStage("create");
      }
    });
  }, [title, body, selectedLabels]);

  const handleImageSelect = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) {
      return;
    }
    startUploadTransition(async () => {
      setError(null);
      setErrorStage(null);
      try {
        const uploaded = await Promise.all(Array.from(fileList).map((file) => uploadImage(file)));
        setImages((current) => [...current, ...uploaded]);
      } catch (err) {
        setError(toUiError(err));
        setErrorStage("upload");
      }
    });
  };

  const stepState = (step: Step): "complete" | "active" | "idle" => {
    if (step < activeStep) return "complete";
    if (step === activeStep) return "active";
    return "idle";
  };

  const canNavigateTo = useCallback(
    (step: Step): boolean => {
      if (isLoading) return false;
      if (step === 1) return true;
      if (step === 2) return questions.length > 0;
      if (step === 3) return !!body;
      return false;
    },
    [isLoading, questions.length, body],
  );

  const handleStepClick = useCallback(
    (step: Step) => {
      if (canNavigateTo(step)) setActiveStep(step);
    },
    [canNavigateTo],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      // Cmd/Ctrl + Enter: continue action (works even in inputs)
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (activeStep === 1) handleContinueFromPrompt();
        // Step 2 continue is handled by QuestionsStep's own keyboard handler
        // because it depends on the active question index
        if (activeStep === 3 && !issueUrl) handleCreateIssue();
        return;
      }

      // Don't handle other shortcuts when typing
      if (isInput) return;

      // Escape to go back one step
      if (e.key === "Escape" && activeStep > 1) {
        const prevStep = (activeStep - 1) as Step;
        if (canNavigateTo(prevStep)) setActiveStep(prevStep);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeStep, handleContinueFromPrompt, handleCreateIssue, canNavigateTo, issueUrl]);

  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
  const modKey = isMac ? "\u2318" : "Ctrl";

  return (
    <div className="app-shell">
      <AppHeader githubLogin={props.githubLogin}>
        {props.githubLogin && (
          <nav className="stepper">
            <button
              className="stepper-step"
              data-state={stepState(1)}
              onClick={() => handleStepClick(1)}
              type="button"
            >
              <span className="stepper-circle">{stepState(1) === "complete" ? "\u2713" : "1"}</span>
              <span className="stepper-label">Describe</span>
            </button>
            <div className="stepper-line" data-complete={activeStep > 1 || undefined} />
            <button
              className="stepper-step"
              data-state={stepState(2)}
              onClick={() => handleStepClick(2)}
              disabled={!canNavigateTo(2) && activeStep < 2}
              type="button"
            >
              <span className="stepper-circle">{stepState(2) === "complete" ? "\u2713" : "2"}</span>
              <span className="stepper-label">Clarify</span>
            </button>
            <div className="stepper-line" data-complete={activeStep > 2 || undefined} />
            <button
              className="stepper-step"
              data-state={stepState(3)}
              onClick={() => handleStepClick(3)}
              disabled={!canNavigateTo(3) && activeStep < 3}
              type="button"
            >
              <span className="stepper-circle">{stepState(3) === "complete" ? "\u2713" : "3"}</span>
              <span className="stepper-label">Review</span>
            </button>
          </nav>
        )}
      </AppHeader>

      {props.githubLogin ? (
        <main className="main-content">
          <UserFacingError error={error} />

          <div className="step-content">
            {activeStep === 1 && (
              <PromptStep
                prompt={prompt}
                images={images}
                onPromptChange={setPrompt}
                onImageSelect={handleImageSelect}
                onContinue={handleContinueFromPrompt}
                uploading={isUploading}
                generating={isGeneratingQuestions}
                error={errorStage === "questions" || errorStage === "upload" ? error : null}
                modKey={modKey}
              />
            )}

            {activeStep === 2 &&
              (isGeneratingQuestions ? (
                <LoadingSkeleton type="questions" />
              ) : (
                <QuestionsStep
                  questions={questions}
                  answers={answers}
                  onAnswerChange={(questionId, value) =>
                    setAnswers((current) => ({ ...current, [questionId]: value }))
                  }
                  onContinue={handleContinueFromQuestions}
                  modKey={modKey}
                />
              ))}

            {activeStep === 3 &&
              (isGeneratingDraft || isGeneratingQuestions || !body ? (
                <LoadingSkeleton type="draft" />
              ) : (
                <DraftStep
                  title={title}
                  body={body}
                  action={action}
                  agents={agents}
                  onTitleChange={setTitle}
                  onBodyChange={setBody}
                  onActionChange={handleActionChange}
                  onAgentToggle={handleAgentToggle}
                  onCreateIssue={handleCreateIssue}
                  creating={isCreatingIssue}
                  issueUrl={issueUrl}
                  modKey={modKey}
                />
              ))}
          </div>
        </main>
      ) : (
        <main className="main-content">
          <div className="sign-in-prompt">
            <h2>Sign in to get started</h2>
            <p>Sign in with an approved GitHub account to create issues.</p>
          </div>
        </main>
      )}
    </div>
  );
}

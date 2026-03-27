"use client";

import React from "react";
import type { AgentChoice, IssueAction } from "@/lib/labels";
import { MarkdownEditor } from "./markdown-editor";

export function DraftStep(props: {
  title: string;
  body: string;
  action: IssueAction;
  agents: AgentChoice[];
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onActionChange: (value: IssueAction) => void;
  onAgentToggle: (value: AgentChoice) => void;
  onCreateIssue: () => void;
  creating: boolean;
  issueUrl: string | null;
  modKey: string;
}) {
  if (!props.body) {
    return null;
  }

  return (
    <div className="step-panel">
      <h2 className="step-title">Review your issue</h2>

      <label className="field-stack">
        <span className="field-label">Title</span>
        <input
          className="text-input"
          onChange={(event) => props.onTitleChange(event.currentTarget.value)}
          value={props.title}
          maxLength={120}
        />
      </label>

      <div className="field-stack">
        <span className="field-label">Body</span>
        <MarkdownEditor value={props.body} onChange={props.onBodyChange} />
      </div>

      <div className="draft-options">
        <div className="draft-option-group">
          <span className="field-label">Mode</span>
          <div className="segmented-control">
            <button
              className="segment"
              data-active={props.action === "do"}
              onClick={() => props.onActionChange("do")}
              type="button"
            >
              Do it
            </button>
            <button
              className="segment"
              data-active={props.action === "plan"}
              onClick={() => props.onActionChange("plan")}
              type="button"
            >
              Plan first
            </button>
          </div>
        </div>

        <div className="draft-option-group">
          <span className="field-label">Agent</span>
          <div className="agent-pills">
            <label className="agent-pill" data-selected={props.agents.includes("codex")}>
              <input
                checked={props.agents.includes("codex")}
                onChange={() => props.onAgentToggle("codex")}
                type="checkbox"
              />
              Codex
            </label>
            <label className="agent-pill" data-selected={props.agents.includes("claude")}>
              <input
                checked={props.agents.includes("claude")}
                onChange={() => props.onAgentToggle("claude")}
                type="checkbox"
              />
              Claude
            </label>
          </div>
        </div>
      </div>

      <div className="step-footer">
        {props.issueUrl ? (
          <div className="success-row">
            <span className="success-label">Issue created</span>
            <a className="primary-button" href={props.issueUrl} rel="noreferrer" target="_blank">
              Open issue
            </a>
          </div>
        ) : (
          <div className="step-footer-right">
            <span className="shortcut-hint">{props.modKey}+Enter</span>
            <button
              className="primary-button"
              disabled={
                props.creating || props.title.trim().length === 0 || props.body.trim().length === 0
              }
              onClick={props.onCreateIssue}
              type="button"
            >
              {props.creating ? "Creating\u2026" : "Create issue"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

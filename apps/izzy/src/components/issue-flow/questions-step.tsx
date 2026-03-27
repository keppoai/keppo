"use client";

import React, { useState, useEffect, useCallback } from "react";
import type { ClarificationQuestion } from "@/lib/contracts";

const readCheckboxValue = (currentValue: string[] | string | undefined): string[] =>
  Array.isArray(currentValue) ? currentValue : [];

export function QuestionsStep(props: {
  questions: ClarificationQuestion[];
  answers: Record<string, string | string[]>;
  onAnswerChange: (questionId: string, value: string | string[]) => void;
  onContinue: () => void;
  modKey: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (props.questions.length === 0) {
    return null;
  }

  const question = props.questions[activeIndex]!;
  const isLast = activeIndex === props.questions.length - 1;
  const total = props.questions.length;

  const handleNext = useCallback(() => {
    if (isLast) {
      props.onContinue();
    } else {
      setActiveIndex((i) => i + 1);
    }
  }, [isLast, props.onContinue]);

  const handlePrev = useCallback(() => {
    if (activeIndex > 0) {
      setActiveIndex((i) => i - 1);
    }
  }, [activeIndex]);

  // Keyboard navigation
  // eslint-disable-next-line react-hooks/rules-of-hooks -- length > 0 guard above ensures stable call
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTextarea = target.tagName === "TEXTAREA";

      // Cmd/Ctrl + Enter: advance (works in textareas too)
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleNext();
        return;
      }

      // Don't intercept typing in textareas
      if (isTextarea) return;

      // Enter: advance to next question
      if (e.key === "Enter") {
        e.preventDefault();
        handleNext();
      }

      // Shift+Tab or Up: go to previous question
      if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
        if (activeIndex > 0) {
          e.preventDefault();
          handlePrev();
        }
      }

      // Number keys to select radio/checkbox options
      const numKey = parseInt(e.key, 10);
      if (numKey >= 1 && numKey <= 9) {
        const options = question.options ?? [];
        const option = options[numKey - 1];
        if (!option) return;

        if (question.type === "radio") {
          props.onAnswerChange(question.id, option.id);
        } else if (question.type === "checkbox") {
          const current = readCheckboxValue(props.answers[question.id]);
          const next = current.includes(option.id)
            ? current.filter((v) => v !== option.id)
            : [...current, option.id];
          props.onAnswerChange(question.id, next);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNext, handlePrev, activeIndex]);

  return (
    <div className="step-panel typeform-panel">
      <div className="typeform-header">
        <span className="typeform-counter">
          {activeIndex + 1} of {total}
        </span>
        <div className="typeform-dots">
          {props.questions.map((q, i) => (
            <button
              key={q.id}
              className="typeform-dot"
              data-active={i === activeIndex}
              data-answered={props.answers[q.id] !== undefined && props.answers[q.id] !== ""}
              onClick={() => setActiveIndex(i)}
              type="button"
              aria-label={`Question ${String(i + 1)}`}
            />
          ))}
        </div>
      </div>

      <div className="typeform-question">
        <label className="question-label">{question.label}</label>
        <p className="question-help">{question.helpText}</p>

        {question.type === "textarea" ? (
          <textarea
            className="answer-textarea"
            onChange={(event) => props.onAnswerChange(question.id, event.currentTarget.value)}
            placeholder={question.placeholder ?? "Add details"}
            rows={3}
            value={
              typeof props.answers[question.id] === "string"
                ? String(props.answers[question.id])
                : ""
            }
            autoFocus
          />
        ) : null}

        {question.type === "radio" ? (
          <div className="option-stack">
            {(question.options ?? []).map((option, optIndex) => (
              <label className="option-card" key={option.id}>
                <input
                  checked={props.answers[question.id] === option.id}
                  name={question.id}
                  onChange={() => props.onAnswerChange(question.id, option.id)}
                  type="radio"
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
                <kbd className="option-key">{optIndex + 1}</kbd>
              </label>
            ))}
          </div>
        ) : null}

        {question.type === "checkbox" ? (
          <div className="option-stack">
            {(question.options ?? []).map((option, optIndex) => {
              const currentValue = readCheckboxValue(props.answers[question.id]);
              const checked = currentValue.includes(option.id);
              return (
                <label className="option-card" key={option.id}>
                  <input
                    checked={checked}
                    onChange={() => {
                      const next = checked
                        ? currentValue.filter((value) => value !== option.id)
                        : [...currentValue, option.id];
                      props.onAnswerChange(question.id, next);
                    }}
                    type="checkbox"
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                  <kbd className="option-key">{optIndex + 1}</kbd>
                </label>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="step-footer typeform-footer">
        {activeIndex > 0 && (
          <button className="secondary-button" onClick={handlePrev} type="button">
            Back
          </button>
        )}
        <div className="step-footer-right">
          <span className="shortcut-hint">{isLast ? `${props.modKey}+Enter` : "Enter \u21B5"}</span>
          <button className="primary-button" onClick={handleNext} type="button">
            {isLast ? "Continue" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

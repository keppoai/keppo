"use client";

import React, { useState, useEffect } from "react";

const QUESTION_MESSAGES = [
  "Analyzing your prompt\u2026",
  "Gathering repo context\u2026",
  "Generating questions\u2026",
];

const DRAFT_MESSAGES = [
  "Analyzing your answers\u2026",
  "Gathering repo context\u2026",
  "Drafting your issue\u2026",
];

export function LoadingSkeleton({ type }: { type: "questions" | "draft" }) {
  const messages = type === "questions" ? QUESTION_MESSAGES : DRAFT_MESSAGES;
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((i) => (i + 1) % messages.length);
    }, 2200);
    return () => clearInterval(interval);
  }, [messages.length]);

  return (
    <div className="loading-skeleton">
      <div className="loading-spinner" />
      <p className="loading-message">{messages[messageIndex]}</p>
      <div className="skeleton-lines">
        <div className="skeleton-line" style={{ width: "70%" }} />
        <div className="skeleton-line" style={{ width: "90%" }} />
        <div className="skeleton-line" style={{ width: "55%" }} />
        <div className="skeleton-line" style={{ width: "80%" }} />
      </div>
    </div>
  );
}

"use client";

import React from "react";

type ErrorPayload = {
  code: string;
  title: string;
  summary: string;
  nextSteps: string[];
  technicalDetails: string | null;
};

export type { ErrorPayload };

export function UserFacingError({ error }: { error: ErrorPayload | null }) {
  if (!error) {
    return null;
  }

  return (
    <div className="error-card" role="alert">
      <h3>{error.title}</h3>
      <p>{error.summary}</p>
      <p>
        <strong>Error code:</strong> <code>{error.code}</code>
      </p>
      {error.nextSteps.length > 0 ? (
        <ul>
          {error.nextSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      ) : null}
      {error.technicalDetails ? (
        <details>
          <summary>Technical details</summary>
          <pre>{error.technicalDetails}</pre>
        </details>
      ) : null}
    </div>
  );
}

"use client";

import React, { useState } from "react";
import type { UploadedImage } from "@/lib/contracts";
import { UserFacingError, type ErrorPayload } from "@/components/user-facing-error";

export function PromptStep(props: {
  prompt: string;
  images: UploadedImage[];
  onPromptChange: (value: string) => void;
  onImageSelect: (fileList: FileList | null) => void;
  onContinue: () => void;
  uploading: boolean;
  generating: boolean;
  error: ErrorPayload | null;
  modKey: string;
}) {
  const [showImageUpload, setShowImageUpload] = useState(props.images.length > 0);
  const trimmedPrompt = props.prompt.trim();
  const canContinue = trimmedPrompt.length > 0 && !props.uploading && !props.generating;

  return (
    <div className="step-panel">
      <h2 className="step-title">What do you need?</h2>

      <textarea
        className="prompt-textarea"
        onChange={(event) => props.onPromptChange(event.currentTarget.value)}
        placeholder="Describe the problem and what you want done…"
        rows={6}
        value={props.prompt}
        autoFocus
      />

      {showImageUpload || props.images.length > 0 ? (
        <div className="image-upload-section">
          <label className="upload-area">
            <input
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              onChange={(event) => props.onImageSelect(event.currentTarget.files)}
              type="file"
            />
            <span>{props.uploading ? "Uploading\u2026" : "Choose files or drag here"}</span>
          </label>
          {props.images.length > 0 && (
            <div className="image-thumbnails">
              {props.images.map((image) => (
                <a
                  key={image.url}
                  href={image.url}
                  target="_blank"
                  rel="noreferrer"
                  className="image-thumb"
                >
                  <img src={image.url} alt={image.pathname} />
                </a>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button className="add-images-btn" onClick={() => setShowImageUpload(true)} type="button">
          + Add images
        </button>
      )}

      <UserFacingError error={props.error} />

      <div className="step-footer">
        <span className="shortcut-hint">{props.modKey}+Enter</span>
        <button
          className="primary-button"
          disabled={!canContinue}
          onClick={props.onContinue}
          type="button"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

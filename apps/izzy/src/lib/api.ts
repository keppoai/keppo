"use client";

import type {
  CreateIssueRequest,
  DraftRequest,
  DraftResponse,
  QuestionsRequest,
  QuestionsResponse,
  UploadedImage,
} from "./contracts";

export class IzzyApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

const postJson = async <TResponse>(path: string, body: unknown): Promise<TResponse> => {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as TResponse | { error?: { summary?: string } };
  if (!response.ok) {
    throw new IzzyApiError(
      typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "object" &&
        payload.error !== null &&
        "summary" in payload.error &&
        typeof payload.error.summary === "string"
        ? payload.error.summary
        : "Request failed",
      response.status,
      payload,
    );
  }
  return payload as TResponse;
};

export const requestClarificationQuestions = async (body: QuestionsRequest) =>
  await postJson<{ ok: true } & QuestionsResponse>("/api/issue-authoring/questions", body);

export const requestIssueDraft = async (body: DraftRequest) =>
  await postJson<{ ok: true } & DraftResponse>("/api/issue-authoring/draft", body);

export const createIssue = async (body: CreateIssueRequest) =>
  await postJson<{ ok: true; issueNumber: number; issueUrl: string }>("/api/issues/create", body);

export const uploadImage = async (file: File): Promise<UploadedImage> => {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/uploads", {
    method: "POST",
    body: formData,
  });
  const payload = (await response.json()) as { ok?: boolean; image?: UploadedImage };
  if (!response.ok || !payload.image) {
    throw new IzzyApiError("Image upload failed", response.status, payload);
  }
  return payload.image;
};

import { z } from "zod";
import { ACTION_LABELS, AGENT_LABELS } from "./labels";

const nonEmptyString = z.string().trim().min(1);

export const issueActionSchema = z.enum(["plan", "do"]);
export const agentChoiceSchema = z.enum(["claude", "codex"]);

export const uploadedImageSchema = z.object({
  url: z.string().url(),
  pathname: nonEmptyString,
  contentType: nonEmptyString,
  sizeBytes: z.number().int().positive(),
  alt: z.string().trim().max(200).optional().nullable(),
});

export const clarificationOptionSchema = z.object({
  id: nonEmptyString.max(64),
  label: nonEmptyString.max(120),
  description: nonEmptyString.max(220),
});

export const clarificationQuestionSchema = z.object({
  id: nonEmptyString.max(64),
  label: nonEmptyString.max(160),
  helpText: nonEmptyString.max(260),
  type: z.enum(["radio", "checkbox", "textarea"]),
  required: z.boolean(),
  options: z.array(clarificationOptionSchema).max(6).optional(),
  placeholder: z.string().trim().max(120).optional(),
});

export const clarificationQuestionGenerationSchema = z.object({
  id: nonEmptyString.max(64),
  label: nonEmptyString.max(160),
  helpText: nonEmptyString.max(260),
  type: z.enum(["radio", "checkbox", "textarea"]),
  required: z.boolean(),
  options: z.array(clarificationOptionSchema).max(6).nullable(),
  placeholder: z.string().trim().max(120).nullable(),
});

export const questionsRequestSchema = z.object({
  prompt: nonEmptyString.max(4_000),
  action: issueActionSchema,
  agents: z.array(agentChoiceSchema).min(1).max(2),
  images: z.array(uploadedImageSchema).max(4).default([]),
});

export const questionsResponseSchema = z.object({
  questions: z.array(clarificationQuestionSchema).max(4),
  contextFiles: z.array(nonEmptyString).max(8),
  imageNotes: z.array(nonEmptyString).max(4).default([]),
});

export const questionsGenerationSchema = z.object({
  questions: z.array(clarificationQuestionGenerationSchema).max(4),
  imageNotes: z.array(nonEmptyString).max(4),
});

export const answerValueSchema = z.union([z.string(), z.array(z.string())]);

export const draftRequestSchema = z.object({
  prompt: nonEmptyString.max(4_000),
  action: issueActionSchema,
  agents: z.array(agentChoiceSchema).min(1).max(2),
  images: z.array(uploadedImageSchema).max(4).default([]),
  answers: z.record(nonEmptyString.max(64), answerValueSchema).default({}),
});

export const issueDraftSchema = z.object({
  title: nonEmptyString.max(120),
  summary: nonEmptyString.max(320),
  problem: nonEmptyString.max(1_500),
  desiredOutcome: nonEmptyString.max(1_500),
  suggestedExtraLabels: z.array(nonEmptyString.max(80)).max(8).default([]),
});

export const issueDraftGenerationSchema = z.object({
  title: nonEmptyString.max(120),
  summary: nonEmptyString.max(320),
  problem: nonEmptyString.max(1_500),
  desiredOutcome: nonEmptyString.max(1_500),
  suggestedExtraLabels: z.array(nonEmptyString.max(80)).max(8),
});

export const draftResponseSchema = z.object({
  draft: issueDraftSchema,
  bodyMarkdown: nonEmptyString,
  selectedLabels: z.array(nonEmptyString.max(80)).min(1),
  availableLabels: z.array(nonEmptyString.max(80)).max(200),
  contextFiles: z.array(nonEmptyString).max(8),
  imageNotes: z.array(nonEmptyString).max(4).default([]),
});

export const createIssueRequestSchema = z.object({
  title: nonEmptyString.max(120),
  body: nonEmptyString.max(20_000),
  labels: z.array(nonEmptyString.max(80)).min(1).max(20),
});

export const createIssueResponseSchema = z.object({
  issueNumber: z.number().int().positive(),
  issueUrl: z.string().url(),
});

export type UploadedImage = z.infer<typeof uploadedImageSchema>;
export type ClarificationQuestion = z.infer<typeof clarificationQuestionSchema>;
export type ClarificationQuestionGeneration = z.infer<typeof clarificationQuestionGenerationSchema>;
export type QuestionsRequest = z.infer<typeof questionsRequestSchema>;
export type QuestionsResponse = z.infer<typeof questionsResponseSchema>;
export type DraftRequest = z.infer<typeof draftRequestSchema>;
export type DraftResponse = z.infer<typeof draftResponseSchema>;
export type IssueDraft = z.infer<typeof issueDraftSchema>;
export type IssueDraftGeneration = z.infer<typeof issueDraftGenerationSchema>;
export type CreateIssueRequest = z.infer<typeof createIssueRequestSchema>;

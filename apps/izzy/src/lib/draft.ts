import { generateObject, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { buildIssueLabels, type AgentChoice, type IssueAction } from "./labels";
import {
  draftResponseSchema,
  issueDraftGenerationSchema,
  issueDraftSchema,
  type DraftRequest,
  type IssueDraftGeneration,
  type UploadedImage,
} from "./contracts";
import { getServerEnv } from "./env";
import type { RepoContextSnippet } from "./github-repo-context";
import { buildDraftPrompt } from "./prompts";

const describeImages = async (
  modelName: string,
  apiKey: string,
  images: UploadedImage[],
): Promise<string[]> => {
  if (images.length === 0) {
    return [];
  }
  const openai = createOpenAI({ apiKey });
  const { text } = await generateText({
    model: openai(modelName),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Describe each attached issue image in one sentence that would help an engineer understand the visual context. Keep the same order as the images.",
          },
          ...images.map((image) => ({
            type: "image" as const,
            image: image.url,
          })),
        ],
      },
    ],
  });
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^[-\d.\s]+/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, images.length);
};

export const buildIssueBodyMarkdown = (params: {
  draft: Awaited<ReturnType<typeof issueDraftSchema.parse>>;
  images: UploadedImage[];
  imageNotes: string[];
}): string => {
  const sections = [
    params.draft.summary,
    "## Problem",
    params.draft.problem,
    "## Desired outcome",
    params.draft.desiredOutcome,
  ];

  if (params.images.length > 0) {
    const attachments = params.images
      .map((image, index) => {
        const note = params.imageNotes[index] ? `\nDescription: ${params.imageNotes[index]}` : "";
        return `- ${image.pathname}\n  ${image.url}${note}`;
      })
      .join("\n");
    sections.push("## Attachments", attachments);
  }

  return sections.join("\n\n");
};

export const generateIssueDraft = async (params: {
  input: DraftRequest;
  context: RepoContextSnippet[];
  availableLabels: string[];
}): Promise<Awaited<ReturnType<typeof draftResponseSchema.parse>>> => {
  const env = getServerEnv();
  const openai = createOpenAI({ apiKey: env.IZZY_OPENAI_API_KEY });
  const imageNotes = await describeImages(
    env.IZZY_AI_MODEL,
    env.IZZY_OPENAI_API_KEY,
    params.input.images,
  );
  const { object } = await generateObject({
    model: openai(env.IZZY_AI_MODEL),
    schema: issueDraftGenerationSchema,
    prompt: buildDraftPrompt({
      input: params.input,
      context: params.context,
      imageNotes,
    }),
  });

  const draft = issueDraftSchema.parse({
    ...object,
    suggestedExtraLabels: (object as IssueDraftGeneration).suggestedExtraLabels,
  });

  const selectedLabels = buildIssueLabels(
    params.input.action as IssueAction,
    params.input.agents as AgentChoice[],
  );
  const suggestedExtraLabels = draft.suggestedExtraLabels.filter((label) =>
    params.availableLabels.includes(label),
  );
  const bodyMarkdown = buildIssueBodyMarkdown({
    draft,
    images: params.input.images,
    imageNotes,
  });

  return draftResponseSchema.parse({
    draft,
    bodyMarkdown,
    selectedLabels: [...selectedLabels, ...suggestedExtraLabels],
    availableLabels: params.availableLabels,
    contextFiles: params.context.map((entry) => entry.path),
    imageNotes,
  });
};

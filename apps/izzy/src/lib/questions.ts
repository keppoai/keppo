import { generateObject, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import {
  questionsGenerationSchema,
  type ClarificationQuestion,
  type ClarificationQuestionGeneration,
  type QuestionsRequest,
  type UploadedImage,
} from "./contracts";
import { getServerEnv } from "./env";
import type { RepoContextSnippet } from "./github-repo-context";
import { buildQuestionsPrompt } from "./prompts";

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
            text: "Describe each image in one concise bullet that would help an engineer understand the issue context. Keep the bullets in the same order as the images.",
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

export const generateClarificationQuestions = async (params: {
  input: QuestionsRequest;
  context: RepoContextSnippet[];
}): Promise<{
  questions: ClarificationQuestion[];
  imageNotes: string[];
}> => {
  const env = getServerEnv();
  const imageNotes = await describeImages(
    env.IZZY_AI_MODEL,
    env.IZZY_OPENAI_API_KEY,
    params.input.images,
  );
  const openai = createOpenAI({ apiKey: env.IZZY_OPENAI_API_KEY });
  const { object } = await generateObject({
    model: openai(env.IZZY_AI_MODEL),
    schema: questionsGenerationSchema,
    prompt: buildQuestionsPrompt({
      input: params.input,
      context: params.context,
      imageNotes,
    }),
  });

  const questions: ClarificationQuestion[] = object.questions.map(
    (question: ClarificationQuestionGeneration) => {
      const normalized: ClarificationQuestion = {
        id: question.id,
        label: question.label,
        helpText: question.helpText,
        type: question.type,
        required: question.required,
      };
      if (question.options !== null) {
        normalized.options = question.options;
      }
      if (question.placeholder !== null) {
        normalized.placeholder = question.placeholder;
      }
      return normalized;
    },
  );

  return {
    questions,
    imageNotes: object.imageNotes.length > 0 ? object.imageNotes : imageNotes,
  };
};

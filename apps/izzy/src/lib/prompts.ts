import type { DraftRequest, QuestionsRequest, UploadedImage } from "./contracts";
import type { RepoContextSnippet } from "./github-repo-context";

const formatImages = (images: UploadedImage[], imageNotes: string[]): string => {
  if (images.length === 0) {
    return "No images were attached.";
  }
  return images
    .map((image, index) => {
      const note = imageNotes[index] ? `\nAI image note: ${imageNotes[index]}` : "";
      return `- ${image.pathname} (${image.contentType}, ${String(image.sizeBytes)} bytes)\n  URL: ${image.url}${note}`;
    })
    .join("\n");
};

const formatAnswers = (answers: Record<string, string | string[]>): string => {
  const entries = Object.entries(answers);
  if (entries.length === 0) {
    return "No clarification answers were provided.";
  }
  return entries
    .map(([key, value]) => `- ${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
    .join("\n");
};

const formatContext = (context: RepoContextSnippet[]): string =>
  context
    .map((entry) => `## ${entry.path}\n${entry.description}\n\n${entry.snippet}`.trim())
    .join("\n\n");

export const buildQuestionsPrompt = (params: {
  input: QuestionsRequest;
  context: RepoContextSnippet[];
  imageNotes: string[];
}): string =>
  `
You are helping a human write a high-signal GitHub issue for keppoai/keppo.

Generate at most 4 clarification questions that will materially improve issue quality.
Return only questions that are necessary before drafting the final issue.
Use only these question types: radio, checkbox, textarea.
Prefer radio or checkbox when the user is choosing between known implementation directions.
Do not ask questions whose answer is already implied by the prompt or repo context.
Return a JSON object with both keys: "questions" and "imageNotes".
Always include "imageNotes" as an array, even when it is empty.

Issue action: ${params.input.action}
Requested agents: ${params.input.agents.join(", ")}

User prompt:
${params.input.prompt}

Images:
${formatImages(params.input.images, params.imageNotes)}

Repo context:
${formatContext(params.context)}
`.trim();

export const buildDraftPrompt = (params: {
  input: DraftRequest;
  context: RepoContextSnippet[];
  imageNotes: string[];
}): string =>
  `
You are drafting a GitHub issue for keppoai/keppo.

Write a concise, focused issue for a smart engineering agent. Less is more.
Focus on the decisions the user has made and the problem to solve.
Do not include obvious implementation details — the receiving agent can figure those out.
Do not invent repo behavior that is not supported by the provided context.
Return a JSON object that always includes "suggestedExtraLabels" as an array, even when it is empty.

The issue body should contain only:
- A one-line summary
- The problem being solved
- The desired outcome

Keep each section brief and high-signal. Avoid boilerplate, filler, or restating what is obvious from the title.

Issue action: ${params.input.action}
Requested agents: ${params.input.agents.join(", ")}

Original prompt:
${params.input.prompt}

Clarification answers:
${formatAnswers(params.input.answers)}

Images:
${formatImages(params.input.images, params.imageNotes)}

Repo context:
${formatContext(params.context)}
`.trim();

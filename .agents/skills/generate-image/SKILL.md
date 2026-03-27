---
name: generate-image
description: Generate an image using the Dyad engine API and save it locally.
---

# Generate Image

Generate an AI image from a text prompt using the Dyad engine endpoint. Only available when the `DYAD_PRO_KEY` environment variable is set.

## When to Use

- User requests a custom image, illustration, icon, or graphic
- User wants a hero image, background, banner, or visual asset
- Creating images that are more visually relevant than placeholders

## Workflow

1. Confirm `DYAD_PRO_KEY` is set. If not, tell the user to set it and stop.
2. Craft a detailed, descriptive prompt. Be specific about:
   - **Subject** — what is in the image (objects, people, scenes)
   - **Style** — photography, illustration, flat design, 3D render, watercolor, etc.
   - **Composition** — layout, perspective, framing
   - **Colors** — specific color palette or mood
   - **Mood** — cheerful, professional, dramatic, minimal, etc.
3. Run the generation script with the prompt.
4. The script prints the saved file path on success.
5. Use the generated image in the project (e.g., copy to `public/assets/`).

## Script

```bash
bash .agents/skills/generate-image/scripts/generate-image.sh "<prompt>"
```

The script calls the Dyad engine `/images/generations` endpoint, decodes the base64 response, and saves a PNG to `ux-artifacts/generated/`.

## Prompt Examples

- `"A modern flat illustration of a team collaborating around a laptop, blue and purple palette, clean minimal style with subtle gradients, white background"`
- `"Professional product photography of a sleek smartphone on a marble surface, soft studio lighting, shallow depth of field, warm neutral tones"`
- `"Minimalist line-art logo of a shield with a key inside, single color, suitable for a security app icon"`

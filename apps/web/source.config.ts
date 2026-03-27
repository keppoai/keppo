import { z } from "zod";
import { defineConfig, defineDocs, frontmatterSchema } from "fumadocs-mdx/config";

const docsFrontmatterSchema = frontmatterSchema.extend({
  audience: z.enum(["user-guide", "self-hosted", "contributors"]).optional(),
  summary: z.string().trim().min(1).optional(),
  releaseDate: z.string().trim().min(1).optional(),
  tagline: z.string().trim().min(1).optional(),
});

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    dynamic: false,
    schema: docsFrontmatterSchema,
  },
});

export default defineConfig();

import { describe, expect, it } from "vitest";
import { validateImageFile } from "./issue-image-upload";

describe("image upload validation", () => {
  it("rejects unsupported file types", () => {
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    expect(() => validateImageFile(file)).toThrow("invalid_image_type");
  });

  it("accepts png images", () => {
    const file = new File(["hello"], "shot.png", { type: "image/png" });
    expect(() => validateImageFile(file)).not.toThrow();
  });
});

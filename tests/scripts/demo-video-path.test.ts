import { describe, expect, it } from "vitest";

import {
  normalizeDemoVideoPath,
  readDemoVideoPathFromMetadata,
} from "../../scripts/issue-agent/demo-video-path.mjs";

describe("demo-video-path", () => {
  it("normalizes leading dot segments under ux-artifacts/video-demos", () => {
    expect(normalizeDemoVideoPath("./ux-artifacts/video-demos/demo.webm")).toBe(
      "ux-artifacts/video-demos/demo.webm",
    );
  });

  it("rejects traversal outside the demo directory", () => {
    expect(() => normalizeDemoVideoPath("ux-artifacts/video-demos/../secret.txt")).toThrow(
      "demo.videoPath must be under ux-artifacts/video-demos/",
    );
  });

  it("reads an optional validated demo path from metadata", () => {
    expect(
      readDemoVideoPathFromMetadata({
        demo: {
          summary: "Demo summary",
          videoPath: "./ux-artifacts/video-demos/test-demo.webm",
        },
      }),
    ).toBe("ux-artifacts/video-demos/test-demo.webm");
    expect(readDemoVideoPathFromMetadata({ title: "No demo" })).toBe("");
  });
});

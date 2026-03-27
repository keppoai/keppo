import { describe, expect, it } from "vitest";
import { formatIgnoredPortWarning, stripIgnoredPortArgs } from "../../scripts/dev.mjs";

describe("scripts/dev.mjs", () => {
  it("strips separate port flags and values", () => {
    expect(stripIgnoredPortArgs(["--port", "4100", "-p", "4200"])).toEqual({
      ignoredPortArgs: ["--port 4100", "-p 4200"],
      passthroughArgs: [],
    });
  });

  it("strips inline port flags and preserves unrelated args", () => {
    expect(stripIgnoredPortArgs(["--port=4100", "--host", "0.0.0.0", "-p=4200"])).toEqual({
      ignoredPortArgs: ["--port=4100", "-p=4200"],
      passthroughArgs: ["--host", "0.0.0.0"],
    });
  });

  it("formats a fixed-port warning", () => {
    expect(formatIgnoredPortWarning(["--port 4100"])).toBe(
      "Warning: ignoring user-supplied port flag (--port 4100). Keppo dev uses fixed local ports.",
    );
  });
});

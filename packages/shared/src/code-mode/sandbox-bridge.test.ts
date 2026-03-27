import { describe, expect, it } from "vitest";
import {
  REQUEST_PREFIX,
  RESULT_PREFIX,
  buildBridgeEntrySource,
  buildHttpBridgeEntrySource,
} from "./sandbox-bridge.js";

describe("sandbox bridge entry sources", () => {
  it("builds the file-based bridge entry source", () => {
    const source = buildBridgeEntrySource('console.log("hello"); return 1;', "/tmp/responses");

    expect(source).toContain('import { mkdir, readFile, rm } from "node:fs/promises";');
    expect(source).toContain(`const REQUEST_PREFIX = ${JSON.stringify(REQUEST_PREFIX)};`);
    expect(source).toContain(`const RESULT_PREFIX = ${JSON.stringify(RESULT_PREFIX)};`);
    expect(source).toContain('const RESPONSE_DIR = "/tmp/responses";');
    expect(source).toContain("await mkdir(RESPONSE_DIR, { recursive: true });");
    expect(source).toContain("const responsePath = `${RESPONSE_DIR}/${requestId}.json`;");
  });

  it("builds the HTTP bridge entry source", () => {
    const source = buildHttpBridgeEntrySource(
      'return await gmail.sendEmail({ to: "a@example.com" });',
      "https://bridge.keppo.ai/callback",
    );

    expect(source).toContain('const BRIDGE_CALLBACK_URL = "https://bridge.keppo.ai/callback";');
    expect(source).toContain("const response = await fetch(BRIDGE_CALLBACK_URL, {");
    expect(source).toContain("body: JSON.stringify(requestPayload),");
    expect(source).toContain(
      "process.stdout.write(`${REQUEST_PREFIX}${JSON.stringify(requestPayload)}\\n`);",
    );
    expect(source).toContain('throw new Error("Bridge response was not valid JSON.");');
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractFirstJsonObject } from "./extract-json.mjs";

describe("extractFirstJsonObject", () => {
  it("returns clean JSON unchanged", () => {
    const input = '{"summary":"hello"}';
    assert.equal(extractFirstJsonObject(input), input);
  });

  it("strips trailing garbage after valid JSON", () => {
    const json = '{"summary":"verdict"}';
    const input = json + '\n*** End Patch\n天天中彩票♀♀♀♀assistant';
    assert.equal(extractFirstJsonObject(input), json);
  });

  it("strips leading whitespace/garbage before JSON", () => {
    const json = '{"summary":"ok"}';
    const input = "some preamble text " + json + " trailing";
    assert.equal(extractFirstJsonObject(input), json);
  });

  it("handles nested braces", () => {
    const json = '{"summary":"a { b } c"}';
    const input = json + "\nextra stuff";
    assert.equal(extractFirstJsonObject(input), json);
  });

  it("handles escaped quotes in strings", () => {
    const json = '{"summary":"she said \\"hello\\""}';
    const input = json + "\ngarbage";
    const result = extractFirstJsonObject(input);
    assert.equal(result, json);
    assert.deepEqual(JSON.parse(result), { summary: 'she said "hello"' });
  });

  it("handles nested objects", () => {
    const json = '{"a":{"b":"c"},"d":"e"}';
    const input = json + "}\n}extra";
    assert.equal(extractFirstJsonObject(input), json);
  });

  it("handles braces inside string values", () => {
    const json = '{"summary":"use {x} and {y}"}';
    const input = json + "\n\nmore text";
    assert.equal(extractFirstJsonObject(input), json);
  });

  it("returns raw input when no brace is found", () => {
    const input = "no json here";
    assert.equal(extractFirstJsonObject(input), input);
  });

  it("returns raw input for unclosed JSON (fallback)", () => {
    const input = '{"summary":"unclosed';
    assert.equal(extractFirstJsonObject(input), input);
  });

  it("handles the real-world Codex failure case", () => {
    const validJson = '{"summary":"**Verdict: NO**\\n\\n| Severity | File |\\n| HIGH | `queries.ts` |"}';
    const garbage =
      '***\\n*** End Patch\n天天中彩票♀♀♀♀♀♀assistant to=functions.exec_command' +
      '***Jsii  微信公众号天天中彩票json\n***"cmd":"jq -e ."***';
    const input = validJson + garbage;
    const result = extractFirstJsonObject(input);
    assert.equal(result, validJson);
    assert.doesNotThrow(() => JSON.parse(result));
  });
});

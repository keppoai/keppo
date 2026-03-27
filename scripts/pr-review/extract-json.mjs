/**
 * Extract the first complete JSON object from raw output.
 * LLM outputs sometimes append trailing garbage (prompt leakage, extra tokens)
 * after valid JSON — find the balanced top-level `{}` and parse only that.
 */
export function extractFirstJsonObject(raw) {
  const start = raw.indexOf("{");
  if (start === -1) return raw;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return raw; // fallback: let JSON.parse surface the error
}

export type ErrorTextSignals = {
  normalizedText: string;
  codes: ReadonlySet<string>;
  words: ReadonlySet<string>;
};

const CODE_PATTERN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;
const WORD_PATTERN = /[a-z0-9]+/g;

const hasWords = (words: ReadonlySet<string>, required: readonly string[]): boolean => {
  for (const requiredWord of required) {
    if (!words.has(requiredWord)) {
      return false;
    }
  }
  return true;
};

const addDerivedCodes = (codes: Set<string>, words: ReadonlySet<string>): void => {
  if (hasWords(words, ["not", "found"])) {
    codes.add("not_found");
  }
  if (words.has("throttled") || hasWords(words, ["too", "many", "requests"])) {
    codes.add("rate_limited");
  }
  if (words.has("timeout") || words.has("aborted") || hasWords(words, ["timed", "out"])) {
    codes.add("timeout");
  }
  if (hasWords(words, ["gateway", "timeout"])) {
    codes.add("gateway_timeout");
  }
  if (hasWords(words, ["invalid", "token"]) || hasWords(words, ["bad", "credentials"])) {
    codes.add("invalid_token");
  }
  if (hasWords(words, ["missing", "access", "token"])) {
    codes.add("missing_access_token");
  }
  if (hasWords(words, ["invalid", "access", "token"])) {
    codes.add("invalid_access_token");
  }
  if (hasWords(words, ["expired", "access", "token"])) {
    codes.add("expired_access_token");
  }
  if (hasWords(words, ["missing", "bearer", "token"])) {
    codes.add("missing_access_token");
  }
  if (hasWords(words, ["not", "logged", "in"])) {
    codes.add("invalid_token");
  }
  if (hasWords(words, ["text", "too", "long"])) {
    codes.add("text_too_long");
  }
};

export const createErrorTextSignals = (...values: unknown[]): ErrorTextSignals => {
  const normalizedText = values
    .map((value) => String(value ?? ""))
    .join(" ")
    .trim()
    .toLowerCase();
  const codes = new Set<string>();
  const words = new Set<string>();

  for (const match of normalizedText.matchAll(WORD_PATTERN)) {
    words.add(match[0]);
  }
  for (const match of normalizedText.matchAll(CODE_PATTERN)) {
    codes.add(match[0]);
  }

  addDerivedCodes(codes, words);

  return { normalizedText, codes, words };
};

export const hasErrorCode = (signals: ErrorTextSignals, ...candidates: string[]): boolean => {
  const normalizedCandidates = candidates.map((candidate) => candidate.trim().toLowerCase());
  return normalizedCandidates.some((candidate) => signals.codes.has(candidate));
};

export const hasErrorCodePrefix = (signals: ErrorTextSignals, ...prefixes: string[]): boolean => {
  const normalizedPrefixes = prefixes.map((prefix) => prefix.trim().toLowerCase());
  for (const code of signals.codes) {
    for (const prefix of normalizedPrefixes) {
      if (prefix.length > 0 && code.startsWith(prefix)) {
        return true;
      }
    }
  }
  return false;
};

export const hasAnyWord = (signals: ErrorTextSignals, ...candidates: string[]): boolean => {
  const normalizedCandidates = candidates.map((candidate) => candidate.trim().toLowerCase());
  return normalizedCandidates.some((candidate) => signals.words.has(candidate));
};

export const hasAllWords = (signals: ErrorTextSignals, ...required: string[]): boolean => {
  const normalizedRequired = required.map((word) => word.trim().toLowerCase());
  return hasWords(signals.words, normalizedRequired);
};

const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

export const sanitizeCustomServerUrl = (value: string): string => value.trim();

export const validateCustomServerUrl = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "Enter the full MCP server URL before saving.";
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Enter a complete http:// or https:// URL.";
  }

  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
    return "Custom servers must use http:// or https:// URLs.";
  }

  if (!parsed.hostname) {
    return "Enter a URL that includes a hostname.";
  }

  return null;
};

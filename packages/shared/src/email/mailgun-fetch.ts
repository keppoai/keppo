export type SendMailgunEmailArgs = {
  apiKey: string | undefined;
  domain: string | undefined;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendMailgunEmailResult = {
  success: boolean;
  error?: string;
  retryable?: boolean;
};

const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404, 422]);

const toBase64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const combined = (first << 16) | (second << 8) | third;

    output += alphabet[(combined >> 18) & 63];
    output += alphabet[(combined >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(combined >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? alphabet[combined & 63] : "=";
  }

  return output;
};

const parseResponseError = async (response: Response): Promise<string> => {
  const body = await response.text();
  return body.trim() || `Mailgun request failed with status ${response.status}`;
};

export const sendMailgunEmail = async (
  args: SendMailgunEmailArgs,
): Promise<SendMailgunEmailResult> => {
  const apiKey = args.apiKey?.trim();
  const domain = args.domain?.trim();

  if (!apiKey || !domain) {
    return {
      success: false,
      error: "Mailgun is not configured",
      retryable: false,
    };
  }

  const form = new URLSearchParams();
  form.set("from", args.from);
  form.set("to", args.to);
  form.set("subject", args.subject);
  form.set("text", args.text);
  form.set("html", args.html);

  const url = `https://api.mailgun.net/v3/${domain}/messages`;
  const authToken = toBase64(`api:${apiKey}`);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    if (response.ok) {
      return { success: true };
    }

    return {
      success: false,
      error: await parseResponseError(response),
      retryable: !NON_RETRYABLE_STATUS_CODES.has(response.status),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: message,
      retryable: true,
    };
  }
};

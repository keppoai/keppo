import FormData from "form-data";
import Mailgun from "mailgun.js";
import type { NotificationPayload as DeliveryNotificationPayload } from "@keppo/shared/notifications";
import { getEnv } from "./env.js";

type SendResult = {
  success: boolean;
  error?: string;
  retryable?: boolean;
};

type SendInviteEmailArgs = {
  to: string;
  inviterName: string;
  orgName: string;
  acceptUrl: string;
};

let cachedClient: {
  messages: {
    create: (
      domain: string,
      data: {
        from: string;
        to: string[];
        subject: string;
        text: string;
        html: string;
      },
    ) => Promise<unknown>;
  };
  domain: string;
  from: string;
} | null = null;

const resolveDashboardOrigin = (): string => {
  const env = getEnv();
  return (env.KEPPO_DASHBOARD_ORIGIN ?? "http://localhost:3000").replace(/\/+$/, "");
};

const toAbsoluteUrl = (value: string): string => {
  if (/^https?:\/\//.test(value)) {
    return value;
  }
  return `${resolveDashboardOrigin()}${value.startsWith("/") ? value : `/${value}`}`;
};

const buildNotificationTemplate = (
  payload: DeliveryNotificationPayload,
): { html: string; text: string } => {
  const ctaUrl = toAbsoluteUrl(payload.ctaUrl);
  const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4efe5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#27392d;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 24px;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid rgba(63,111,79,0.12);border-radius:20px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 20px;">
                <span style="font-weight:700;font-size:20px;color:#2f563c;letter-spacing:-0.02em;">Keppo</span>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px;">
                <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;font-weight:600;color:#27392d;">${payload.title}</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a5d50;">${payload.body}</p>
                <a href="${ctaUrl}" style="display:inline-block;background:#3f6f4f;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:15px;font-weight:600;">${payload.ctaLabel}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid rgba(63,111,79,0.10);color:#7a8f80;font-size:12px;line-height:1.5;">
                You're receiving this because you're a member of ${payload.orgName} on Keppo.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();

  const text = `${payload.title}\n\n${payload.body}\n\n${payload.ctaLabel}: ${ctaUrl}\n\nYou're receiving this because you're a member of ${payload.orgName} on Keppo.`;
  return { html, text };
};

const buildInviteTemplate = (
  payload: SendInviteEmailArgs,
): { subject: string; html: string; text: string } => {
  const acceptUrl = toAbsoluteUrl(payload.acceptUrl);
  const subject = `${payload.inviterName} invited you to join ${payload.orgName} on Keppo`;
  const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4efe5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#27392d;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 24px;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid rgba(63,111,79,0.12);border-radius:20px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 20px;">
                <span style="font-weight:700;font-size:20px;color:#2f563c;letter-spacing:-0.02em;">Keppo</span>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px;">
                <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;font-weight:600;color:#27392d;">You're invited to collaborate</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a5d50;">
                  ${payload.inviterName} invited you to join <strong style="color:#27392d;">${payload.orgName}</strong>.
                </p>
                <a href="${acceptUrl}" style="display:inline-block;background:#3f6f4f;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:15px;font-weight:600;">Accept invitation</a>
                <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#7a8f80;">This invitation expires in 7 days.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();
  const text = `${payload.inviterName} invited you to join ${payload.orgName} on Keppo.\n\nAccept invitation: ${acceptUrl}\n\nThis invitation expires in 7 days.`;
  return { subject, html, text };
};

const resolveClient = () => {
  if (cachedClient) {
    return cachedClient;
  }

  const env = getEnv();
  const apiKey = env.MAILGUN_API_KEY;
  const domain = env.MAILGUN_DOMAIN;
  const from = env.MAILGUN_FROM_EMAIL ?? "notifications@keppo.ai";
  if (!apiKey || !domain) {
    return null;
  }

  const mailgun = new Mailgun(FormData);
  const client = mailgun.client({
    username: "api",
    key: apiKey,
  });

  cachedClient = {
    messages: client.messages,
    domain,
    from,
  };
  return cachedClient;
};

export const sendNotificationEmail = async (
  to: string,
  payload: DeliveryNotificationPayload,
): Promise<SendResult> => {
  const client = resolveClient();
  if (!client) {
    return {
      success: false,
      error: "Mailgun is not configured",
      retryable: false,
    };
  }

  const rendered = buildNotificationTemplate(payload);
  try {
    await client.messages.create(client.domain, {
      from: client.from,
      to: [to],
      subject: payload.title,
      text: rendered.text,
      html: rendered.html,
    });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode =
      typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status?: unknown }).status)
        : undefined;

    return {
      success: false,
      error: message,
      retryable: !(
        statusCode === 400 ||
        statusCode === 401 ||
        statusCode === 403 ||
        statusCode === 422
      ),
    };
  }
};

export const sendInviteEmail = async (payload: SendInviteEmailArgs): Promise<SendResult> => {
  const client = resolveClient();
  if (!client) {
    if (getEnv().KEPPO_E2E_MODE) {
      return { success: true };
    }
    return {
      success: false,
      error: "Mailgun is not configured",
      retryable: false,
    };
  }

  const rendered = buildInviteTemplate(payload);
  try {
    await client.messages.create(client.domain, {
      from: client.from,
      to: [payload.to],
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode =
      typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status?: unknown }).status)
        : undefined;

    return {
      success: false,
      error: message,
      retryable: !(
        statusCode === 400 ||
        statusCode === 401 ||
        statusCode === 403 ||
        statusCode === 422
      ),
    };
  }
};

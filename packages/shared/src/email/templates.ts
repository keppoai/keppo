export type MagicLinkTemplate = {
  subject: string;
  html: string;
  text: string;
};

export const buildMagicLinkTemplate = (email: string, url: string): MagicLinkTemplate => {
  const subject = "Your Keppo magic sign-in link";
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
                <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;font-weight:600;color:#27392d;">Sign in to Keppo</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a5d50;">
                  Use this secure magic link to finish signing in as <strong style="color:#27392d;">${email}</strong>.
                </p>
                <a href="${url}" style="display:inline-block;background:#3f6f4f;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:15px;font-weight:600;">Sign in to Keppo</a>
                <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#7a8f80;">If you did not request this email, you can safely ignore it.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid rgba(63,111,79,0.10);color:#7a8f80;font-size:12px;line-height:1.5;">
                This message was sent by Keppo authentication.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();

  const text = `Sign in to Keppo\n\nUse this secure magic link to finish signing in as ${email}.\n\nSign in to Keppo: ${url}\n\nIf you did not request this email, you can safely ignore it.`;

  return { subject, html, text };
};

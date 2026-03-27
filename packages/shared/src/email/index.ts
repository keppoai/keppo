import {
  sendMailgunEmail,
  type SendMailgunEmailArgs,
  type SendMailgunEmailResult,
} from "./mailgun-fetch.js";
import { buildMagicLinkTemplate, type MagicLinkTemplate } from "./templates.js";

export { buildMagicLinkTemplate, sendMailgunEmail };
export type { MagicLinkTemplate, SendMailgunEmailArgs, SendMailgunEmailResult };

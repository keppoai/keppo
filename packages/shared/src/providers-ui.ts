import { CANONICAL_PROVIDER_IDS, type CanonicalProviderId } from "./provider-catalog.js";

export type ProviderUiFieldType =
  | "text"
  | "textarea"
  | "number"
  | "email"
  | "json"
  | "csv"
  | "checkboxes";

export type ProviderUiField = {
  id: string;
  label: string;
  type: ProviderUiFieldType;
  placeholder?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
};

export type ProviderUiStateContext = {
  externalAccountId: string | null;
  signedInUserEmail: string | null;
  integrationMetadata: Record<string, unknown>;
};

export type ProviderUiActionContext = {
  selectedWriteTool: string | null;
  availableWriteTools: Array<string>;
};

export type ProviderUiActionRequest = {
  toolName: string;
  input: Record<string, unknown>;
};

export type ProviderUiIcon =
  | "google"
  | "stripe"
  | "slack"
  | "github"
  | "notion"
  | "reddit"
  | "x"
  | "custom";

export type ProviderTestActionField = {
  key: string;
  label: string;
  type: "text" | "textarea";
};

export type ProviderTestActionTemplate = {
  toolName: string;
  label: string;
  defaults: Record<string, string>;
  fields: Array<ProviderTestActionField>;
  buildInput: (values: Record<string, string>) => Record<string, unknown>;
};

export type ProviderAutoApprovalPreset = {
  toolName: string;
  riskLevel: "low" | "medium" | "high" | "critical";
};

export type ProviderMetadataEditorConfig = {
  id: string;
  title: string;
  description: string;
  fields: Array<ProviderUiField>;
  defaults: Record<string, unknown>;
  submitLabel: string;
  successMessage: string;
  hydrateValues?: (context: ProviderUiStateContext) => Record<string, unknown>;
  buildMetadataPatch: (values: Record<string, unknown>) => Record<string, unknown>;
};

export type ProviderDetailUiConfig = {
  panelTitle: string;
  panelDescription: string;
  fields: Array<ProviderUiField>;
  defaults: Record<string, unknown>;
  fixedToolName?: string;
  metadataEditors: Array<ProviderMetadataEditorConfig>;
  hydrateDefaults?: (context: ProviderUiStateContext) => Record<string, unknown>;
  buildActionRequest: (
    values: Record<string, unknown>,
    context: ProviderUiActionContext,
  ) => ProviderUiActionRequest;
};

const toRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const parseCsvValue = (value: unknown): Array<string> => {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const parseCsvString = (value: string | undefined): Array<string> => {
  return parseCsvValue(value ?? "");
};

const parseJsonObjectValue = (value: unknown): Record<string, unknown> => {
  if (typeof value === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error("Write payload must be valid JSON.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Write payload must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Write payload must be a JSON object.");
  }

  return value as Record<string, unknown>;
};

const buildGenericActionRequest = (
  values: Record<string, unknown>,
  context: ProviderUiActionContext,
): ProviderUiActionRequest => {
  const toolName = context.selectedWriteTool ?? context.availableWriteTools[0] ?? "";
  if (!toolName) {
    throw new Error("No write tools are configured for this provider.");
  }

  return {
    toolName,
    input: parseJsonObjectValue(values.payload),
  };
};

const DEFAULT_GENERIC_UI: ProviderDetailUiConfig = {
  panelTitle: "Run write action",
  panelDescription:
    "Choose a write-capable tool and provide a JSON payload to execute through the normal action flow.",
  fields: [
    {
      id: "payload",
      label: "Write payload (JSON object)",
      type: "json",
      required: true,
      placeholder: '{\n  "example": "value"\n}',
    },
  ],
  defaults: {
    payload: {},
  },
  metadataEditors: [],
  buildActionRequest: buildGenericActionRequest,
};

const GENERIC_TOOL_DEFAULT_INPUTS: Record<string, Record<string, unknown>> = {
  "slack.postMessage": {
    channel: "#support",
    text: "Test message from integration detail page",
  },
  "notion.createPage": {
    title: "Integration test page",
    content: "Created from Keppo integration detail page",
  },
  "reddit.createPost": {
    subreddit: "support",
    title: "Integration test post",
    body: "Created from Keppo integration detail page",
  },
  "x.createPost": {
    body: "Integration test post from Keppo",
  },
  "custom.callWrite": {
    tool: "credits.adjust",
    payload: {
      customer_id: "cus_100",
      amount: 1,
    },
  },
};

const DEFAULT_AUTO_APPROVAL_PRESETS: Array<ProviderAutoApprovalPreset> = [
  { toolName: "gmail.applyLabel", riskLevel: "low" },
  { toolName: "gmail.archive", riskLevel: "low" },
  { toolName: "gmail.sendEmail", riskLevel: "high" },
  { toolName: "stripe.issueRefund", riskLevel: "high" },
  { toolName: "stripe.cancelSubscription", riskLevel: "medium" },
];

const GOOGLE_TEST_ACTION_TEMPLATES: Array<ProviderTestActionTemplate> = [
  {
    toolName: "gmail.sendEmail",
    label: "Send Email",
    defaults: {
      to: "alice@example.com",
      cc: "",
      bcc: "",
      subject: "Q4 Budget Review",
      body: "Hi Alice,\n\nPlease review the attached Q4 budget report and share feedback by Friday.\n\nThanks,\nBob",
    },
    fields: [
      { key: "to", label: "To (comma-separated)", type: "text" },
      { key: "cc", label: "CC (comma-separated)", type: "text" },
      { key: "bcc", label: "BCC (comma-separated)", type: "text" },
      { key: "subject", label: "Subject", type: "text" },
      { key: "body", label: "Body", type: "textarea" },
    ],
    buildInput: (values) => ({
      to: parseCsvString(values.to),
      cc: parseCsvString(values.cc),
      bcc: parseCsvString(values.bcc),
      subject: values.subject ?? "",
      body: values.body ?? "",
    }),
  },
  {
    toolName: "gmail.replyToThread",
    label: "Reply to Thread",
    defaults: {
      threadId: "thread_18abc123def",
      to: "alice@example.com",
      body: "Thanks for the update. I'll review this by end of day.",
    },
    fields: [
      { key: "threadId", label: "Thread ID", type: "text" },
      { key: "to", label: "To (comma-separated)", type: "text" },
      { key: "body", label: "Body", type: "textarea" },
    ],
    buildInput: (values) => ({
      threadId: values.threadId ?? "",
      to: parseCsvString(values.to),
      body: values.body ?? "",
    }),
  },
  {
    toolName: "gmail.applyLabel",
    label: "Apply Label",
    defaults: {
      threadId: "thread_18abc123def",
      label: "IMPORTANT",
    },
    fields: [
      { key: "threadId", label: "Thread ID", type: "text" },
      { key: "label", label: "Label", type: "text" },
    ],
    buildInput: (values) => ({
      threadId: values.threadId ?? "",
      label: values.label ?? "",
    }),
  },
  {
    toolName: "gmail.archive",
    label: "Archive Thread",
    defaults: {
      threadId: "thread_18abc123def",
    },
    fields: [{ key: "threadId", label: "Thread ID", type: "text" }],
    buildInput: (values) => ({
      threadId: values.threadId ?? "",
    }),
  },
];

const PROVIDER_TEST_ACTION_TEMPLATES: Partial<
  Record<CanonicalProviderId, Array<ProviderTestActionTemplate>>
> = {
  google: GOOGLE_TEST_ACTION_TEMPLATES,
};

const googleUiConfig: ProviderDetailUiConfig = {
  panelTitle: "Send test email",
  panelDescription: "Create and approve a gmail.sendEmail action.",
  fixedToolName: "gmail.sendEmail",
  fields: [
    { id: "to", label: "To", type: "csv", required: true, placeholder: "recipient@example.com" },
    { id: "cc", label: "CC", type: "csv", placeholder: "cc@example.com" },
    { id: "bcc", label: "BCC", type: "csv", placeholder: "bcc@example.com" },
    { id: "subject", label: "Subject", type: "text", required: true },
    { id: "body", label: "Body", type: "textarea", required: true },
  ],
  defaults: {
    to: "",
    cc: "",
    bcc: "",
    subject: "Integration test from Google",
    body: "This is a Google integration test action sent from Keppo.",
  },
  metadataEditors: [],
  hydrateDefaults: (context) => ({
    to: context.signedInUserEmail ?? context.externalAccountId ?? "",
  }),
  buildActionRequest: (values) => {
    const to = parseCsvValue(values.to);
    const subject = typeof values.subject === "string" ? values.subject.trim() : "";
    const body = typeof values.body === "string" ? values.body.trim() : "";

    if (to.length === 0) {
      throw new Error("To address is required.");
    }
    if (!subject || !body) {
      throw new Error("Subject and body are required.");
    }

    return {
      toolName: "gmail.sendEmail",
      input: {
        to,
        cc: parseCsvValue(values.cc),
        bcc: parseCsvValue(values.bcc),
        subject,
        body,
      },
    };
  },
};

export const STRIPE_WRITE_MODES = [
  { value: "refund", label: "Refund" },
  { value: "cancel_subscription", label: "Cancel subscription" },
  { value: "adjust_balance", label: "Adjust balance" },
  { value: "update_customer", label: "Update customer" },
  { value: "update_subscription", label: "Update subscription" },
  { value: "resume_subscription", label: "Resume subscription" },
  { value: "invoice_actions", label: "Invoice actions" },
  { value: "credit_notes", label: "Credit notes" },
  { value: "disputes", label: "Disputes" },
  { value: "portal_session", label: "Portal session" },
  { value: "payment_methods", label: "Payment methods" },
  { value: "invoice_items", label: "Invoice items" },
] as const;

const stripeWriteModesEditor: ProviderMetadataEditorConfig = {
  id: "stripe-write-modes",
  title: "Stripe write mode policy",
  description: "Configure write operations this integration is allowed to execute.",
  fields: [
    {
      id: "allowed_write_modes",
      label: "Allowed write modes",
      type: "checkboxes",
      options: STRIPE_WRITE_MODES.map((mode) => ({ value: mode.value, label: mode.label })),
    },
  ],
  defaults: {
    allowed_write_modes: Object.fromEntries(STRIPE_WRITE_MODES.map((mode) => [mode.value, true])),
  },
  submitLabel: "Save write modes",
  successMessage: "Stripe write modes saved.",
  hydrateValues: (context) => {
    const configured = context.integrationMetadata.allowed_write_modes;
    if (configured === undefined || configured === null) {
      return {};
    }
    if (Array.isArray(configured)) {
      const modeSet = new Set(configured.map((entry) => String(entry).toLowerCase()));
      return {
        allowed_write_modes: Object.fromEntries(
          STRIPE_WRITE_MODES.map((mode) => [mode.value, modeSet.has(mode.value)]),
        ),
      };
    }
    if (typeof configured === "string") {
      const modeSet = new Set(
        configured
          .split(",")
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean),
      );
      return {
        allowed_write_modes: Object.fromEntries(
          STRIPE_WRITE_MODES.map((mode) => [mode.value, modeSet.has(mode.value)]),
        ),
      };
    }
    return {};
  },
  buildMetadataPatch: (values) => {
    const checkboxMap = values.allowed_write_modes;
    if (!checkboxMap || typeof checkboxMap !== "object" || Array.isArray(checkboxMap)) {
      return { allowed_write_modes: [] };
    }
    const record = checkboxMap as Record<string, unknown>;
    const allowed = STRIPE_WRITE_MODES.filter((mode) => record[mode.value] === true).map(
      (mode) => mode.value,
    );
    return { allowed_write_modes: allowed };
  },
};

const stripeUiConfig: ProviderDetailUiConfig = {
  panelTitle: "Issue test refund",
  panelDescription: "Create and approve a stripe.issueRefund action.",
  fixedToolName: "stripe.issueRefund",
  fields: [
    { id: "customerId", label: "Customer ID", type: "text", required: true },
    { id: "chargeId", label: "Charge ID", type: "text", required: true },
    { id: "amount", label: "Amount", type: "number", required: true },
    { id: "currency", label: "Currency", type: "text", required: true, placeholder: "usd" },
  ],
  defaults: {
    customerId: "cus_100",
    chargeId: "ch_cus_100",
    amount: 49,
    currency: "usd",
  },
  metadataEditors: [stripeWriteModesEditor],
  buildActionRequest: (values) => {
    const customerId = typeof values.customerId === "string" ? values.customerId.trim() : "";
    const chargeId = typeof values.chargeId === "string" ? values.chargeId.trim() : "";
    const amount = typeof values.amount === "number" ? values.amount : Number(values.amount);
    const currency =
      typeof values.currency === "string" ? values.currency.trim().toLowerCase() : "";

    if (!customerId || !chargeId) {
      throw new Error("Customer and charge IDs are required.");
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Amount must be a positive number.");
    }
    if (!currency || currency.length !== 3) {
      throw new Error("Currency must be a 3-letter code.");
    }

    return {
      toolName: "stripe.issueRefund",
      input: {
        customerId,
        chargeId,
        amount,
        currency,
      },
    };
  },
};

const githubAllowlistEditor: ProviderMetadataEditorConfig = {
  id: "github-allowlist",
  title: "GitHub repository allowlist",
  description: "Restrict write actions to approved owner/repository pairs.",
  fields: [
    {
      id: "allowed_repositories",
      label: "Allowed repositories (comma-separated)",
      type: "csv",
      placeholder: "owner/repo, org/another-repo",
    },
  ],
  defaults: {
    allowed_repositories: "",
  },
  submitLabel: "Save allowlist",
  successMessage: "GitHub repository allowlist saved.",
  hydrateValues: (context) => {
    const configured = context.integrationMetadata.allowed_repositories;
    if (Array.isArray(configured)) {
      return {
        allowed_repositories: configured.map((entry) => String(entry)).join(", "),
      };
    }
    if (typeof configured === "string") {
      return {
        allowed_repositories: configured,
      };
    }
    return {};
  },
  buildMetadataPatch: (values) => ({
    allowed_repositories: parseCsvValue(values.allowed_repositories),
  }),
};

const githubUiConfig: ProviderDetailUiConfig = {
  panelTitle: "Comment on issue",
  panelDescription: "Create and approve a github.commentIssue action.",
  fixedToolName: "github.commentIssue",
  fields: [
    { id: "repo", label: "Repository (owner/repo)", type: "text", required: true },
    { id: "issue", label: "Issue Number", type: "number", required: true },
    { id: "body", label: "Comment", type: "textarea", required: true },
  ],
  defaults: {
    repo: "org/repo",
    issue: 12,
    body: "Test comment from Keppo integration page.",
  },
  metadataEditors: [githubAllowlistEditor],
  buildActionRequest: (values) => {
    const repo = typeof values.repo === "string" ? values.repo.trim() : "";
    const issue = typeof values.issue === "number" ? values.issue : Number(values.issue);
    const body = typeof values.body === "string" ? values.body.trim() : "";

    if (!repo || !body) {
      throw new Error("Repository and comment body are required.");
    }
    if (!Number.isInteger(issue) || issue <= 0) {
      throw new Error("Issue number must be a positive integer.");
    }

    return {
      toolName: "github.commentIssue",
      input: {
        repo,
        issue,
        body,
      },
    };
  },
};

const createGenericProviderUi = (providerLabel: string): ProviderDetailUiConfig => ({
  ...DEFAULT_GENERIC_UI,
  panelDescription: `${providerLabel} exposes write capabilities via registry metadata.`,
  defaults: {
    ...DEFAULT_GENERIC_UI.defaults,
  },
  fields: DEFAULT_GENERIC_UI.fields.map((field) => ({ ...field })),
  metadataEditors: [],
});

const PROVIDER_DETAIL_UI: Record<CanonicalProviderId, ProviderDetailUiConfig> = {
  google: googleUiConfig,
  stripe: stripeUiConfig,
  github: githubUiConfig,
  slack: createGenericProviderUi("Slack"),
  notion: createGenericProviderUi("Notion"),
  reddit: createGenericProviderUi("Reddit"),
  x: createGenericProviderUi("X"),
  custom: createGenericProviderUi("Custom"),
};

export type ProviderUiProviderId = keyof typeof PROVIDER_DETAIL_UI;

const PROVIDER_DISPLAY: Record<
  ProviderUiProviderId,
  {
    label: string;
    description: string;
    icon: ProviderUiIcon;
    colorClass: string;
  }
> = {
  google: {
    label: "Google",
    description: "Read and send Gmail via Google OAuth",
    icon: "google",
    colorClass: "bg-red-50 dark:bg-red-950/30",
  },
  stripe: {
    label: "Stripe",
    description: "Look up customers, issue refunds, manage subscriptions",
    icon: "stripe",
    colorClass: "bg-violet-50 dark:bg-violet-950/30",
  },
  slack: {
    label: "Slack",
    description: "List channels, post messages",
    icon: "slack",
    colorClass: "bg-purple-50 dark:bg-purple-950/30",
  },
  github: {
    label: "GitHub",
    description: "List issues, comment on issues and PRs",
    icon: "github",
    colorClass: "bg-gray-50 dark:bg-gray-950/30",
  },
  notion: {
    label: "Notion",
    description: "Search pages, create new pages",
    icon: "notion",
    colorClass: "bg-stone-50 dark:bg-stone-950/30",
  },
  reddit: {
    label: "Reddit",
    description: "Search posts, create new posts",
    icon: "reddit",
    colorClass: "bg-orange-50 dark:bg-orange-950/30",
  },
  x: {
    label: "X",
    description: "Search posts, create new posts",
    icon: "x",
    colorClass: "bg-neutral-50 dark:bg-neutral-950/30",
  },
  custom: {
    label: "Custom",
    description: "Connect your own internal tools via API",
    icon: "custom",
    colorClass: "bg-blue-50 dark:bg-blue-950/30",
  },
};

export const PROVIDER_UI_PROVIDER_IDS = [...CANONICAL_PROVIDER_IDS] as Array<ProviderUiProviderId>;

const PROVIDER_UI_ID_SET = new Set<string>(PROVIDER_UI_PROVIDER_IDS);

export const isProviderUiProviderId = (providerId: string): providerId is ProviderUiProviderId => {
  return PROVIDER_UI_ID_SET.has(providerId);
};

export const getProviderDetailUi = (providerId: CanonicalProviderId): ProviderDetailUiConfig => {
  return PROVIDER_DETAIL_UI[providerId] ?? createGenericProviderUi(providerId);
};

export const getProviderDisplayName = (providerId: ProviderUiProviderId): string => {
  return PROVIDER_DISPLAY[providerId].label;
};

export const getProviderDescription = (providerId: ProviderUiProviderId): string => {
  return PROVIDER_DISPLAY[providerId].description;
};

export const getProviderIcon = (providerId: ProviderUiProviderId): ProviderUiIcon => {
  return PROVIDER_DISPLAY[providerId].icon;
};

export const getProviderColorClass = (providerId: ProviderUiProviderId): string => {
  return PROVIDER_DISPLAY[providerId].colorClass;
};

export const getProviderWriteToolDefaultInput = (toolName: string): Record<string, unknown> => {
  return GENERIC_TOOL_DEFAULT_INPUTS[toolName] ?? {};
};

export const getProviderAutoApprovalPresets = (): Array<ProviderAutoApprovalPreset> => {
  return DEFAULT_AUTO_APPROVAL_PRESETS.map((preset) => ({ ...preset }));
};

export const getProviderTestActionTemplates = (
  providerId: CanonicalProviderId,
): Array<ProviderTestActionTemplate> => {
  const templates = PROVIDER_TEST_ACTION_TEMPLATES[providerId] ?? [];
  return templates.map((template) => ({
    ...template,
    defaults: { ...template.defaults },
    fields: template.fields.map((field) => ({ ...field })),
  }));
};

export const getProviderIdsWithTestActionTemplates = (): Array<CanonicalProviderId> => {
  return CANONICAL_PROVIDER_IDS.filter((providerId) => {
    return (PROVIDER_TEST_ACTION_TEMPLATES[providerId]?.length ?? 0) > 0;
  });
};

export const getDefaultTestActionProviderId = (): CanonicalProviderId | null => {
  return getProviderIdsWithTestActionTemplates()[0] ?? null;
};

export const getProviderUiDefaults = (
  providerId: CanonicalProviderId,
  context: ProviderUiStateContext,
): Record<string, unknown> => {
  const config = getProviderDetailUi(providerId);
  const hydrated = config.hydrateDefaults?.(context) ?? {};
  return {
    ...toRecord(config.defaults),
    ...toRecord(hydrated),
  };
};

export const getProviderMetadataEditorDefaults = (
  editor: ProviderMetadataEditorConfig,
  context: ProviderUiStateContext,
): Record<string, unknown> => {
  const hydrated = editor.hydrateValues?.(context) ?? {};
  return {
    ...toRecord(editor.defaults),
    ...toRecord(hydrated),
  };
};

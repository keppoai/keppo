import { expect, type Locator, type Page } from "@playwright/test";

const normalizePlatformSpecificAriaTokens = (snapshot: string): string =>
  snapshot
    .replace(
      /\b(?:Cmd|Ctrl|Command|Control)(?:\s*\+\s*|\+)(Enter|Return)\b/g,
      "<shortcut-modifier> + $1",
    )
    .replace(/(?:⌘|Cmd|Ctrl)(?:\s*\+\s*|\+)(Enter|Return)\b/g, "<shortcut-modifier> + $1");

export const normalizeAriaSnapshot = (snapshot: string): string => {
  return (
    normalizePlatformSpecificAriaTokens(snapshot)
      .replace(
        /\/[a-z0-9-]+\/settings\/(members|billing|audit|workspaces)\b/gi,
        (_match, section: string) => `/settings/${section}`,
      )
      .replace(/\/[a-z0-9-]+\/settings(?=$|\n|")/gi, "/settings")
      .replace(
        /\/[^/\n"]+\/settings\/(members|billing|audit|workspaces)\b/g,
        (_match, section: string) => `/settings/${section}`,
      )
      .replace(/\/[^/\n"]+\/settings(?=$|\n|")/g, "/settings")
      .replace(
        /\/(?!settings\b|admin\b|login\b|invites\b)[a-z0-9-]+\/(?!settings\b|admin\b|login\b|invites\b)[a-z0-9<>-]+\/(approvals|automations|integrations|rules|prompt-builder|servers)\b/gi,
        (_match, section: string) => `/${section}`,
      )
      .replace(
        /\/(?!settings\b|admin\b|login\b|invites\b)[a-z0-9-]+\/(?!settings\b|admin\b|login\b|invites\b)[a-z0-9<>-]+(?=$|\n|")/gi,
        "/",
      )
      .replace(
        /\b(?:act|workspace|int|cred|run|tcall|audit|cel|taa|blob|ret|org|usr)_[a-z0-9]+\b/gi,
        "<id>",
      )
      .replace(/\b(?:workspace|free-[a-z]+)-[a-z0-9]+\b/gi, "<workspace-name>")
      .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, "<timestamp>")
      .replace(/\b\d+\s+(?:seconds?|minutes?|hours?|days?)\s+ago\b/gi, "<relative-time>")
      .replace(/\b[a-f0-9]{8}-[a-f0-9-]{27}\b/gi, "<uuid>")
      .replace(/\bkeppo_secret_[a-z0-9_]+\b/gi, "<token>")
      .replace(/\b(?:mcp|fake|gmail|stripe|slack|github)_[a-z0-9_]+\b/gi, "<token>")
      .replace(/\/servers\b/g, "/custom-servers")
      .replace(/\/settings\/members\b/g, "/members")
      .replace(/\/settings\/billing\b/g, "/billing")
      .replace(/\/settings\/audit\b/g, "/audit")
      .replace(/\/settings\/workspaces\b/g, "/workspaces")
      .replace(/\/admin\/health\b/g, "/health")
      .replace(/\n\s*- code: <token>\n\s*- button "Copy"/g, "")
      .replace(/\b(Pending Actions|Active Rules|Integrations|Audit Events)\s+\d+\b/g, "$1 <count>")
      .replace(
        /button "(?:Select Workspace|Choose a workspace|[^"]+Select Workspace|[^"]+Keppo[^"]+(?:Manual review|Rules guided|Rules \+ automation))"/g,
        'button "<workspace-selector>"',
      )
      .replace(
        /- button "Keppo [^"\n]*":\n\s*- img "Keppo"\n\s*- text: [^\n]+/g,
        '- button "<workspace-selector>"',
      )
      .replace(
        /- text: [^\n]*Policy Mode (?:manual_only|rules_first|rules_plus_agent)[^\n]*/g,
        "- text: <workspace-policy-summary>",
      )
      .replace(/text: Gmail\s+[^\n"]+@example\.com/g, "text: Gmail <connected-account>")
      .replace(/text: Google\s+[^\n"]+@example\.com/g, "text: Google <connected-account>")
      // "Test Action" enablement can flip during queue hydration without affecting scenario outcomes.
      .replace(/- button "Test Action"(?: \[disabled\])?/g, '- button "Test Action"')
      .replace(
        /(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:\s+(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)){6}(?:\s+\d+)+/g,
        "Sat Sun Mon Tue Wed Thu Fri <chart-axis>",
      )
      .replace(
        /- text: (?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+Approved\s+\d+\s+Rejected\s+\d+\s+Recent Pending Actions/g,
        "- text: Recent Pending Actions",
      )
      .replace(
        /- text: Workspace Integrations[\s\S]*?- text: Workspace MCP credential/g,
        "- text: Workspace Integrations <workspace-integrations>\n  - text: Workspace MCP credential",
      )
      .replace(/\n\s*- button "Setup Guide[^"\n]*"/g, "")
      .replace(/button "[A-Za-z]\s+e2e\+[^"\n]*@example\.com"/g, 'button "E e2e@example.com"')
      .replace(/group "e2e\+[^"\n]*@example\.com"/g, 'group "e2e@example.com"')
      .replace(/text: e2e\+[^"\n]*@example\.com/g, "text: e2e@example.com")
      .replace(
        /- heading "(?:Good morning|Good afternoon|Good evening|Welcome back), [^"\n]+" \[level=1\]/g,
        '- heading "<dashboard-greeting>" [level=1]',
      )
      .replace(
        /\n\s*- heading "What should your next automation do\?" \[level=2\]\n\s*- textbox "Send me an email every morning at 9AM with new GitHub issues"\n\s*- button "Generate automation configuration"(?: \[disabled\])?\n\s*- paragraph: ⌘\+Enter to generate\n\s*- paragraph: "Credits: (?:\d+|-)"/g,
        "",
      )
      .replace(
        /\n\s*- text: Automation builder What should your next automation do\? Describe your automation in plain language and Keppo will guide you step by step to set it up Describe the automation goal\n\s*- textbox "Describe the automation goal":/g,
        "",
      )
      .replace(
        /\n\s*- paragraph: All clear — no actions pending\n\s*- text: Pending Actions <count>\n\s*- paragraph: Actions awaiting approval\n\s*- text: Active Rules <count>\n\s*- paragraph: CEL rules configured\n\s*- text: Integrations <count>\n\s*- paragraph: Connected providers\n\s*- text: Audit Events <count>\n\s*- paragraph: Recent audit entries\n\s*- text: Activity \(7 days\)\n\s*- img: Sat Sun Mon Tue Wed Thu Fri <chart-axis>\n\s*- text: Recent Pending Actions\n\s*- paragraph: No pending actions/g,
        "",
      )
      .replace(/\n?- region "Notifications alt\+T"/g, "")
      .replace(
        /button "Organization settings Billing, members, audit, and org defaults" \[expanded\]/g,
        'button "Organization settings Billing, members, audit, and org defaults"',
      )
      .replace(
        /\n- list:\n  - listitem:\n    - link "Settings":\n      - \/settings\n  - listitem:\n    - link "Members":\n      - \/members\n  - listitem:\n    - link "Billing":\n      - \/billing\n  - listitem:\n    - link "Audit Logs":\n      - \/audit/g,
        "",
      )
      .replace(
        /\n\s*- listitem:\n\s*- link "Approvals(?:\s+\d+\+?)?":\n\s*- \/url: \/approvals/g,
        "",
      )
      .replace(
        /\n\s*- listitem:\n\s*- link "Custom Servers(?:\s+\d+\+?)?":\n\s*- \/url: \/custom-servers/g,
        "",
      )
      .replace(/\n\s*- link "Admin tools":\n\s*- \/url: \/admin/g, "")
      .replace(/\n\s*- button "Notifications"(?:: "[^"]+")?/g, "")
      .replace(/\b\d{9,}\b/g, "<number>")
      .replace(/\n$/, "")
  );
};

export const expectAriaDiffSnapshot = async (params: {
  page: Page;
  name: string;
  root?: Locator;
}): Promise<void> => {
  const root = params.root ?? params.page.locator("body");
  const snapshot = await root.ariaSnapshot();
  expect(`${normalizeAriaSnapshot(snapshot)}\n`).toMatchSnapshot(`${params.name}.aria.txt`);
};

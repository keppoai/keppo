# Keppo Landing Page Draft

> This document describes the landing page structure, copy, and interactions.
> Annotations in `[brackets]` describe visual/interactive behavior.

---

## Navigation Bar

**Logo:** Keppo
**Links:** How it Works | Integrations | Pricing | Docs
**CTAs:** GitHub [star count badge] | Sign In | **Get Started**

---

## Hero Section

**Tagline (small, above headline):** Open-source AI automation platform
**Headline:** AI automations you can trust
**Subheadline:** Describe what you want automated. Keppo handles the rest — with safety guardrails so nothing happens without your say-so.

### Hero Component: Prompt Box

[A large, inviting input area — similar to a chat prompt — with an animated placeholder that cycles through examples. The box has two output slots below it that fill in as the animated placeholder "types."]

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Tell Keppo what to automate...                                │
│                                                                 │
│  [Animated placeholder text cycling through examples:]          │
│                                                                 │
│  "Send me a Slack message whenever a Stripe refund              │
│   over $100 happens"                                            │
│                                                                 │
│                                                        [Go →]   │
└─────────────────────────────────────────────────────────────────┘
         │
         │  [Animates downward — the prompt "dissolves" into
         │   two cards that slide/fade in below:]
         ▼
  ┌──────────────────────┐   ┌───────────────────────────────────┐
  │  ⚡ TRIGGER           │   │  📋 PLAN                          │
  │                      │   │                                   │
  │  When a Stripe       │   │  1. Get refund details            │
  │  refund is created   │   │     (amount, customer, reason)    │
  │  and amount > $100   │   │  2. Send Slack message to         │
  │                      │   │     #finance with summary         │
  │  ☑ Requires approval │   │  3. Log to audit trail            │
  └──────────────────────┘   └───────────────────────────────────┘
```

**Animated placeholder cycles through 3-4 examples (4-second pause between each):**

1. `"Send me a Slack message whenever a Stripe refund over $100 happens"`
   → Trigger: When a Stripe refund is created and amount > $100
   → Plan: Get refund details → Send Slack message to #finance → Log to audit trail

2. `"Every Monday morning, email me a summary of last week's GitHub issues"`
   → Trigger: Every Monday at 9:00 AM
   → Plan: Fetch GitHub issues from past 7 days → Summarize with counts and labels → Send email digest

3. `"When someone sends a support email, create a Notion page and notify the team on Slack"`
   → Trigger: When a new email arrives in support@
   → Plan: Extract subject and body → Create Notion page in Support DB → Post to #support on Slack

4. `"Every day at 5pm, check Stripe for failed payments and send me a report"`
   → Trigger: Every day at 5:00 PM
   → Plan: Query Stripe for failed charges today → Format as summary → Send email report

[When user clicks "Go →" or hits Enter, they're taken to the signup/login screen with their prompt preserved — they'll see their automation being configured after they sign in.]

**Below the prompt box:**
[Small text] No credit card required. Free to start. Open-source.

**Social proof strip:**
[GitHub stars count] | "Trusted by 500+ teams" | [Open-source badge]

---

## "How It Works" Section

**Headline:** Automate anything. Approve everything.
**Subheadline:** Keppo lets AI handle the busywork while you keep control over the actions that matter.

### Three Steps

[Three cards in a row, each with an icon and short description]

**1. Describe it**
Tell Keppo what you want in plain English. It figures out the trigger, the steps, and which tools to use.

**2. Connect your tools**
Link Stripe, Slack, Gmail, GitHub, Notion — whatever your workflow needs. OAuth in 30 seconds.

**3. Stay in control**
Every real action (sending emails, issuing refunds, posting messages) shows up for your approval before it runs. Auto-approve the ones you trust with simple rules.

---

## "See Everything" Section

**Headline:** Know exactly what happened and why
**Subheadline:** Every action comes with a full timeline — what triggered it, which rules evaluated, who approved it, and the result.

[Visual mockup of the action timeline]

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  Stripe Refund — $450 to sarah@example.com               │
│                                                          │
│  ⚡ Trigger fired               Today, 2:34 PM           │
│  📋 Rule matched                                         │
│     ✅ "auto-approve refunds under $500"                  │
│  ✅ Auto-approved                2:34 PM                  │
│  🚀 Sent to Stripe              2:34 PM                  │
│     Refund re_abc123 created successfully                │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Below the mockup:**
No black boxes. No "it just worked." You can see the full chain — from trigger to result — for every single action. Share it with your team, your accountant, or your future self.

---

## "Rules, Not Vibes" Section

**Headline:** Write rules in plain English. They run like code.
**Subheadline:** Tell Keppo what's safe to auto-approve. It creates rock-solid rules that run the same way every time — no AI guessing at runtime.

[Visual showing the natural language → rule → simulation flow]

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  You say:                                                │
│  "Auto-approve Slack messages to #general                │
│   but always ask me about DMs"                           │
│                                                          │
│  ────────────────────────────────────────                 │
│                                                          │
│  Keppo creates a rule:                                   │
│  "Auto-approves Slack messages sent to #general.         │
│   All DMs will still require your approval."             │
│                                                          │
│  What would have happened last week:                     │
│  ✅ 12 messages to #general → auto-approved              │
│  🛑 3 DMs → would still ask you                          │
│                                                          │
│  [Activate Rule]     [Edit]     [Cancel]                 │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Below:**
The AI helps you write rules. But at runtime, it's pure logic — deterministic, auditable, no hallucinations. That's what "trust" actually means.

---

## "Templates" Section

**Headline:** Start in seconds, not hours
**Subheadline:** Pick a template. Connect your accounts. You're live.

[Grid of template cards — 6 visible, "See all →" link]

```
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│ 💰 Refund alerts    │  │ 🐛 Bug to Notion     │  │ 📧 Support triage   │
│                     │  │                     │  │                     │
│ Slack + Stripe      │  │ GitHub + Notion     │  │ Gmail + Slack +     │
│                     │  │                     │  │ Notion              │
│ Alert #finance when │  │ New GitHub issue →   │  │ New support email → │
│ a refund > $100     │  │ Notion page with    │  │ Notion ticket +     │
│ is issued           │  │ details + labels    │  │ Slack notification  │
│                     │  │                     │  │                     │
│ [Use template]      │  │ [Use template]      │  │ [Use template]      │
└─────────────────────┘  └─────────────────────┘  └─────────────────────┘

┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│ 📊 Weekly digest    │  │ 🔔 Payment failures │  │ 🏷️ Auto-label PRs  │
│                     │  │                     │  │                     │
│ GitHub + Gmail      │  │ Stripe + Gmail      │  │ GitHub              │
│                     │  │                     │  │                     │
│ Monday summary of   │  │ Daily check for     │  │ New PR → analyze    │
│ last week's issues  │  │ failed payments →   │  │ diff → apply        │
│ and PR activity     │  │ email report        │  │ relevant labels     │
│                     │  │                     │  │                     │
│ [Use template]      │  │ [Use template]      │  │ [Use template]      │
└─────────────────────┘  └─────────────────────┘  └─────────────────────┘
```

---

## "Integrations" Section

**Headline:** Connects to the tools you already use
**Subheadline:** And any MCP-compatible server you want to add.

[Logo grid of providers]

**Row 1 (built-in):** Slack | Stripe | GitHub | Gmail | Notion | Reddit | X
**Row 2 (coming soon, slightly dimmed):** Linear | HubSpot | Google Calendar | Jira | Discord

**Below logos:**
Plus: connect any MCP server your team already runs. Same approval flow, same audit trail.

---

## Open-Source Section

**Headline:** Open-source. Run it yourself if you want.
**Subheadline:** Keppo is open-source. Self-host it, inspect the code, contribute. Your automations, your infrastructure, your rules.

[GitHub stars badge — large, animated]

**Three cards:**

**🔍 Transparent**
The safety layer that protects your business shouldn't be a black box. Read every line of code that decides what gets approved.

**🏠 Self-hostable**
Run Keppo on your own infrastructure with Docker. Your data never leaves your servers.

**🤝 Community-driven**
Built in the open. Feature requests, bug reports, and PRs welcome.

[CTA: Star on GitHub | View Source]

---

## Note from the Creator

[Photo of Will Chen]

**Will Chen, Creator of Keppo**

"I built Keppo because I kept running into the same problem: AI agents are incredibly capable, but I couldn't let them *do* anything important without babysitting every single action.

The existing automation tools weren't built for this. They assume a human set up the workflow, so every step is predictable. But with AI, the steps aren't predictable — the agent decides what to do based on context. That's powerful, but it means you need a different kind of safety net.

Keppo is that safety net. It's the layer between your AI agent and the real world that makes sure nothing irreversible happens without your approval. And as you build trust — approving the same kind of action over and over — you teach it what's safe with simple rules. The AI helps you write those rules, but the rules themselves run like code: deterministic, auditable, no surprises.

I made it open-source because trust has to be earned, not claimed. If we're going to promise that your AI automations are safe, you should be able to verify that yourself."

---

## Pricing Section

**Headline:** Simple pricing. Start free.
**Subheadline:** No credit card required. Upgrade when you're ready.

### Free
**$0 / month**
Everything you need to start automating.

- 3 automations
- All integrations
- Manual approvals
- CEL rules engine
- Community support
- Self-host option

[Get Started]

### Pro
**$29 / month** [POPULAR badge]
For teams that run on autopilot.

- Unlimited automations
- AI-powered rule authoring
- Rule impact simulation
- Priority sandbox execution
- Email + Slack notifications
- Team members (up to 10)

[Start Free Trial]

### Business
**$99 / month**
For growing teams with bigger needs.

- Everything in Pro
- Unlimited team members
- Advanced analytics
- SIEM export
- SSO
- Priority support

[Contact Us]

---

## FAQ Section

**Headline:** Questions? Answers.

**What does Keppo actually do?**
Keppo runs AI-powered automations across your business tools — Slack, Stripe, Gmail, GitHub, Notion, and more. The difference from other automation tools: every action that changes something in the real world (sending an email, issuing a refund, posting a message) goes through an approval step first. You decide what's safe to auto-approve and what needs a human eye.

**Is it really free?**
Yes. The free plan includes 3 automations with all integrations and the full approval engine. No credit card, no trial timer. You can also self-host the entire platform for free — it's open-source.

**How is this different from Zapier or Make?**
Zapier and Make are workflow builders — you define every step manually. Keppo is AI-native: you describe what you want in plain English, and the AI figures out the steps. But unlike giving an AI agent free rein, Keppo puts a safety layer in between. You see every action before it happens, set rules for what's safe, and get a full audit trail of what happened and why.

**What are "rules" and do I need to write code?**
Rules are the guardrails you set for your automations — like "auto-approve refunds under $100" or "always ask me before sending emails to external addresses." You write them in plain English. Keppo turns them into deterministic logic that runs the same way every time. No code required.

**Can AI approve things without me knowing?**
Only if you explicitly set a rule that says it can. By default, every action that writes, sends, or changes something requires your approval. High-risk actions (large refunds, public posts, account deletions) always require a human, period. This isn't configurable — it's a hard architectural limit.

**What's MCP?**
MCP (Model Context Protocol) is an open standard for AI agents to use tools. Keppo speaks MCP natively, so any AI agent that supports MCP can use Keppo as its safety layer. You can also connect your own MCP servers — same approval flow, same audit trail.

**Can I self-host Keppo?**
Yes. Keppo is open-source under a source-available license. Run it with Docker on your own infrastructure. Your data, your servers, your rules.

**What happens to my data?**
On Keppo Cloud: your data is encrypted at rest and in transit. We store your automation configs, rules, and audit logs. OAuth tokens for your connected services are encrypted with a per-organization key. On self-hosted: everything stays on your servers — we never see it.

---

## Final CTA Section

**Headline:** Start automating. Stay in control.
**Subheadline:** Describe your first automation and Keppo will set it up.

[Same prompt box as hero, repeated here]

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Tell Keppo what to automate...                                │
│                                                                 │
│                                                        [Go →]   │
└─────────────────────────────────────────────────────────────────┘
```

[Below:] Free to start. No credit card. Open-source.

---

## Footer

**Keppo** — AI automations you can trust.

**Product:** Features | Templates | Pricing | Docs | Changelog
**Community:** GitHub | Discord | X (@keppodev)
**Legal:** Terms | Privacy | Security

Built with care by the Keppo team.

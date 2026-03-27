# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately to: `security@keppo.ai`.

Include as much detail as possible:

- Affected component(s) and version/commit
- Reproduction steps or proof-of-concept
- Impact assessment (confidentiality/integrity/availability)
- Any suggested remediation

Do not open public GitHub issues for undisclosed vulnerabilities.

## Response timeline

- Acknowledgement: within 2 business days
- Initial triage: within 5 business days
- Remediation plan/status update: within 10 business days

Critical issues may be mitigated immediately before full remediation.

## Scope

In scope:

- `apps/web`
- `apps/web/app/lib/server/api-runtime`
- `convex/*`
- `packages/shared`
- Deployment and auth configuration documented in `docs/setup.md`

Out of scope:

- Vulnerabilities requiring compromised developer machines or CI credentials
- Social engineering, phishing, or physical attacks
- Denial-of-service requiring unrealistic resource levels

## Safe harbor

We will not pursue legal action for good-faith security research that:

- avoids privacy violations and data destruction,
- avoids service disruption,
- and gives us a reasonable opportunity to remediate before disclosure.

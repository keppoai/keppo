#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const resolveFirstExistingPath = (paths) => {
  for (const path of paths) {
    if (existsSync(path)) {
      return path;
    }
  }
  throw new Error(`Expected one of these files to exist: ${paths.join(", ")}`);
};

const failures = [];

const authSource = read("convex/auth.ts");
if (/\bMath\.random\s*\(/u.test(authSource)) {
  failures.push("convex/auth.ts must not use Math.random() for security-sensitive IDs or secrets.");
}
if (/KEPPO_URL[\s\S]*padEnd\(32,\s*"0"\)/u.test(authSource) || /const seed =/u.test(authSource)) {
  failures.push(
    "convex/auth.ts must not derive BETTER_AUTH_SECRET from KEPPO_URL or deployment metadata.",
  );
}

const betterAuthSource = read("convex/betterAuth/auth.ts");
if (
  /KEPPO_URL[\s\S]*padEnd\(32,\s*"0"\)/u.test(betterAuthSource) ||
  /const seed =/u.test(betterAuthSource)
) {
  failures.push(
    "convex/betterAuth/auth.ts must not derive BETTER_AUTH_SECRET from KEPPO_URL or deployment metadata.",
  );
}

const cryptoHelpersSource = read("convex/crypto_helpers.ts");
if (/BETTER_AUTH_SECRET/u.test(cryptoHelpersSource)) {
  failures.push(
    "convex/crypto_helpers.ts must not fall back to BETTER_AUTH_SECRET for encryption keys.",
  );
}

const orgAiKeysSource = read("convex/org_ai_keys.ts");
if (/BETTER_AUTH_SECRET/u.test(orgAiKeysSource)) {
  failures.push(
    "convex/org_ai_keys.ts must not fall back to BETTER_AUTH_SECRET for encryption keys.",
  );
}

const internalAuthSource = read("apps/web/app/lib/server/api-runtime/internal-auth.ts");
if (!/\btimingSafeEqual\s*\(/u.test(internalAuthSource)) {
  failures.push(
    "apps/web/app/lib/server/api-runtime/internal-auth.ts must use timingSafeEqual for internal bearer checks.",
  );
}
if (/parsedHeader\s*===\s*`Bearer \$\{secret\}`/u.test(internalAuthSource)) {
  failures.push(
    "apps/web/app/lib/server/api-runtime/internal-auth.ts must not compare internal bearer secrets with direct string equality.",
  );
}

const automationRuntimeSource = read("apps/web/app/lib/server/automation-runtime.ts");
if (/KEPPO_CALLBACK_HMAC_SECRET|BETTER_AUTH_SECRET/u.test(automationRuntimeSource)) {
  failures.push(
    "apps/web/app/lib/server/automation-runtime.ts must use the shared callback secret resolver instead of reading callback or auth secrets directly.",
  );
}

const e2eSharedSource = read("convex/e2e_shared.ts");
if (!/CONVEX_DEPLOYMENT/u.test(e2eSharedSource) || !/NODE_ENV/u.test(e2eSharedSource)) {
  failures.push(
    "convex/e2e_shared.ts must require a local/test runtime signal in addition to KEPPO_E2E_MODE.",
  );
}

const deadLetterSource = read("convex/dead_letter.ts");
if (!/export const listPending = internalQuery\(/u.test(deadLetterSource)) {
  failures.push(
    "convex/dead_letter.ts must keep listPending registered as internalQuery so DLQ triage stays internal-only.",
  );
}
if (!/export const replay = internalMutation\(/u.test(deadLetterSource)) {
  failures.push(
    "convex/dead_letter.ts must keep replay registered as internalMutation so DLQ triage stays internal-only.",
  );
}
if (!/export const abandon = internalMutation\(/u.test(deadLetterSource)) {
  failures.push(
    "convex/dead_letter.ts must keep abandon registered as internalMutation so DLQ triage stays internal-only.",
  );
}

const izzyAuthSource = read("apps/izzy/src/lib/auth.ts");
if (/session\.accessToken\s*=\s*token\.accessToken/u.test(izzyAuthSource)) {
  failures.push(
    "apps/izzy/src/lib/auth.ts must not copy the repo-scoped GitHub token into the client-visible NextAuth session.",
  );
}

const appSourcePaths = [
  "apps/web/src/lib/unified-protocol-boundary.ts",
  "apps/web/src/lib/protocol-boundary.ts",
  "apps/web/app/lib/server/admin-health-api.ts",
  "apps/web/app/lib/server/billing-api.ts",
  "apps/web/app/lib/server/internal-api.ts",
  "apps/web/app/lib/server/mcp-api.ts",
  "apps/web/app/lib/server/oauth-api.ts",
  "apps/web/app/lib/server/operational-api.ts",
  "apps/web/app/lib/server/webhook-api.ts",
];
const appSourcePath = resolveFirstExistingPath(appSourcePaths);
const appSource = appSourcePaths.filter(existsSync).map(read).join("\n");
for (const header of [
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "Strict-Transport-Security",
]) {
  if (!appSource.includes(header)) {
    failures.push(
      `${appSourcePath} and related Start-owned handler sources are missing baseline security header handling for ${header}.`,
    );
  }
}

const oauthApiSource = read("apps/web/app/lib/server/oauth-api.ts");
if (!/initiatingUserId:\s*sessionIdentity\.userId/u.test(oauthApiSource)) {
  failures.push(
    "apps/web/app/lib/server/oauth-api.ts must persist the initiating user id in managed OAuth connect state.",
  );
}
if (
  !/managedOAuthConnectState\.initiatingUserId\s*!==\s*sessionIdentity\.userId/u.test(
    oauthApiSource,
  )
) {
  failures.push(
    "apps/web/app/lib/server/oauth-api.ts must revalidate the initiating user before completing org-scoped OAuth callbacks.",
  );
}

if (failures.length > 0) {
  console.error("Security invariant check failed.");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Security invariant check passed.");

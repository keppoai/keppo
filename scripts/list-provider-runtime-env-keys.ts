import {
  listProviderRuntimeSecretKeysForSyncTarget,
  type ProviderRuntimeSyncTarget,
} from "../packages/shared/src/provider-runtime-secrets";

const target = process.argv[2];

if (target !== "local" && target !== "e2e" && target !== "hosted") {
  console.error(
    "Usage: pnpm exec tsx scripts/list-provider-runtime-env-keys.ts <local|e2e|hosted>",
  );
  process.exit(1);
}

for (const key of listProviderRuntimeSecretKeysForSyncTarget(target as ProviderRuntimeSyncTarget)) {
  console.log(key);
}

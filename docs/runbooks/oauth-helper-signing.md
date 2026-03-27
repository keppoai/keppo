# OAuth Helper Signing

Use this runbook when preparing signed macOS and Windows helper releases for the in-repo Tauri desktop helper.

## Symptoms

- GitHub Actions builds the helper but macOS apps still show unsigned or not-notarized warnings.
- Windows bundles build successfully but SmartScreen or signature inspection shows no trusted publisher.
- Release-mode helper workflow fails before artifact upload because signing inputs are incomplete.

## Diagnosis

1. Confirm whether the workflow ran in unsigned validation mode or signed release mode.
   - `release.published` and `workflow_dispatch(require_signing=true)` must fail closed when signing inputs are missing.
   - ordinary `push` builds may continue unsigned so self-hosted operators can validate packaging without production certificates.
2. Check the failing platform job for missing secrets.
   - macOS expects `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_ISSUER`, and `APPLE_API_KEY_P8`.
   - Windows expects `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`, and `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`.
3. Verify the output location.
   - Both jobs upload `apps/oauth-helper/src-tauri/target/release/bundle`.

## Fix

### macOS

1. Export the Developer ID Application certificate to a password-protected `.p12`.
2. Base64-encode the `.p12` and store it in `APPLE_CERTIFICATE`.
3. Store the export password in `APPLE_CERTIFICATE_PASSWORD`.
4. Create an App Store Connect API key for notarization and store:
   - `APPLE_API_KEY` as the key ID
   - `APPLE_API_ISSUER` as the issuer ID
   - `APPLE_API_KEY_P8` as the raw `.p8` private key contents
5. Re-run `oauth-helper-release` with `require_signing=true` or publish a GitHub Release.

### Windows

1. Provision an Azure Trusted Signing account and certificate profile.
2. Store the Azure app credentials:
   - `AZURE_TENANT_ID`
   - `AZURE_CLIENT_ID`
   - `AZURE_CLIENT_SECRET`
3. Store the Trusted Signing resource details:
   - `AZURE_TRUSTED_SIGNING_ENDPOINT`
   - `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
   - `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`
4. Re-run `oauth-helper-release` with `require_signing=true` or publish a GitHub Release.

## Prevention

- Keep unsigned helper packaging available only for local validation and non-release CI runs.
- Treat missing signing inputs as a release blocker, not a warning.
- Rotate Apple and Azure signing credentials outside the repository and update GitHub Actions secrets immediately after rotation.
- Verify notarization and signature status from the produced bundle before updating helper download URLs surfaced by the Keppo API.

# Canonical provider backfill

For legacy deployments with non-canonical provider values at rest.

## Commands

```bash
# Preview pending changes
pnpm run providers:backfill -- preview 200

# Export reversible backup (required before apply)
pnpm run providers:backfill -- export tmp/canonical-provider-backfill.backup.json

# Apply backfill
pnpm run providers:backfill -- apply 200

# Validate storage is canonical-only
pnpm run providers:backfill -- validate 200

# Roll back if needed
pnpm run providers:backfill -- rollback tmp/canonical-provider-backfill.backup.json
```

## No-downtime migration sequence

1. Deploy code supporting both canonical and alias reads.
2. Export backup + apply canonical backfill.
3. Validate `total_changes=0` and `total_invalid_entries=0`.
4. Deploy strict canonical read-path code.
5. Monitor rejection/error metrics for 24h before closing cutover.

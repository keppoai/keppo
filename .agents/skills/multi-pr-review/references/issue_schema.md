# Issue Output Schema

JSON schema for the structured issue output from sub-agents.

## Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "array",
  "items": {
    "type": "object",
    "required": [
      "file",
      "line_start",
      "severity",
      "category",
      "title",
      "description"
    ],
    "properties": {
      "file": {
        "type": "string",
        "description": "Relative path to the file containing the issue"
      },
      "line_start": {
        "type": "integer",
        "minimum": 1,
        "description": "Starting line number of the issue"
      },
      "line_end": {
        "type": "integer",
        "minimum": 1,
        "description": "Ending line number (defaults to line_start if single line)"
      },
      "severity": {
        "type": "string",
        "enum": ["HIGH", "MEDIUM", "LOW"],
        "description": "Criticality level of the issue"
      },
      "category": {
        "type": "string",
        "enum": [
          "security",
          "access-control",
          "auth",
          "logic",
          "performance",
          "query-pattern",
          "indexing",
          "error-handling",
          "accessibility",
          "consistency",
          "interaction",
          "style",
          "other"
        ],
        "description": "Category of the issue. Reviewer prompts must use one of these exact enum values."
      },
      "title": {
        "type": "string",
        "maxLength": 100,
        "description": "Brief, descriptive title for the issue"
      },
      "description": {
        "type": "string",
        "description": "Detailed explanation of the issue and its impact"
      },
      "suggestion": {
        "type": "string",
        "description": "Optional suggestion for how to fix the issue"
      }
    }
  }
}
```

## Example Output

```json
[
  {
    "file": "convex/actions.ts",
    "line_start": 45,
    "line_end": 48,
    "severity": "HIGH",
    "category": "access-control",
    "title": "Missing workspace membership check before action execution",
    "description": "The mutation allows any authenticated user to execute actions in any workspace by passing an arbitrary workspaceId. There is no check that the user is a member of the target workspace.",
    "suggestion": "Add a workspace membership check: const member = await ctx.db.query('workspaceMembers').withIndex('by_workspace_user', q => q.eq('workspaceId', args.workspaceId).eq('userId', userId)).unique(); if (!member) throw new Error('Not a member of this workspace');"
  },
  {
    "file": "convex/integrations.ts",
    "line_start": 112,
    "line_end": 112,
    "severity": "MEDIUM",
    "category": "query-pattern",
    "title": "Unbounded query fetching all integrations without pagination",
    "description": "This query fetches all integrations for a workspace using .collect() with no limit. At 200+ integrations per workspace, this will hit Convex function size limits and cause slow dashboard loads.",
    "suggestion": "Add pagination with .paginate(opts) or limit results with .take(50) and implement cursor-based pagination in the UI"
  }
]
```

## Consensus Output

After aggregation, issues include additional metadata:

```json
{
  "file": "convex/actions.ts",
  "line_start": 45,
  "line_end": 48,
  "severity": "HIGH",
  "category": "access-control",
  "title": "Missing workspace membership check before action execution",
  "description": "...",
  "suggestion": "...",
  "consensus_count": 3,
  "all_severities": ["HIGH", "HIGH", "MEDIUM"]
}
```

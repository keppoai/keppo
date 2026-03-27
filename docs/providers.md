# Providers (Generated)

Generated from `packages/shared/src/providers.ts` module metadata.
Do not edit manually. Run `pnpm run update:provider-docs`.

## Runtime Selection

- Self-hosted deployments can enable a subset with `KEPPO_PROVIDER_MODULES` (CSV canonical provider ids, or `all`).
- Disabled providers are not registered in runtime registry/capability lookup paths.

## Shared Contracts

- Runtime provider ownership (auth/webhook/refresh/tool execution hooks + metadata) is defined in `packages/shared/src/providers.ts`.
- Convex-safe provider default scopes are defined in `packages/shared/src/provider-default-scopes.ts` for V8 query/mutation code paths.
- Dashboard provider detail forms and metadata editors are defined in `packages/shared/src/providers-ui.ts`.
- CI guardrails (`scripts/check-provider-guardrails.ts`) enforce canonical IDs, ownership invariants, and provider UI facet coverage.

## Provider Matrix

| Provider | Auth     | Capabilities                  | Feature Gate                             | Risk     | Deprecation |
| -------- | -------- | ----------------------------- | ---------------------------------------- | -------- | ----------- |
| `custom` | `custom` | read, write                   | `KEPPO_FEATURE_INTEGRATIONS_CUSTOM_FULL` | `high`   | -           |
| `github` | `oauth2` | read, write, refresh, webhook | `KEPPO_FEATURE_INTEGRATIONS_GITHUB_FULL` | `medium` | -           |
| `google` | `oauth2` | read, write, refresh          | `KEPPO_FEATURE_INTEGRATIONS_GOOGLE_FULL` | `high`   | -           |
| `notion` | `oauth2` | read, write                   | `KEPPO_FEATURE_INTEGRATIONS_NOTION_FULL` | `medium` | -           |
| `reddit` | `oauth2` | read, write                   | `KEPPO_FEATURE_INTEGRATIONS_REDDIT_FULL` | `medium` | -           |
| `slack`  | `oauth2` | read, write                   | `KEPPO_FEATURE_INTEGRATIONS_SLACK_FULL`  | `medium` | -           |
| `stripe` | `oauth2` | read, write, refresh, webhook | `KEPPO_FEATURE_INTEGRATIONS_STRIPE_FULL` | `high`   | -           |
| `x`      | `oauth2` | read, write                   | `KEPPO_FEATURE_INTEGRATIONS_X_FULL`      | `medium` | -           |

## Provider Details

### Custom (`custom`)

- Description: Custom integration passthrough tools
- Auth mode: `custom`
- Feature gate: `KEPPO_FEATURE_INTEGRATIONS_CUSTOM_FULL`
- Env requirements: none

| Tool               | Capability | Risk   | Approval |
| ------------------ | ---------- | ------ | -------- |
| `custom.callRead`  | `read`     | `low`  | `false`  |
| `custom.callWrite` | `write`    | `high` | `true`   |

### GitHub (`github`)

- Description: GitHub issue and repository actions
- Auth mode: `oauth2`
- Feature gate: `KEPPO_FEATURE_INTEGRATIONS_GITHUB_FULL`
- Env requirements: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET`

| Tool                           | Capability | Risk     | Approval |
| ------------------------------ | ---------- | -------- | -------- |
| `github.addAssignees`          | `write`    | `low`    | `true`   |
| `github.addLabels`             | `write`    | `low`    | `true`   |
| `github.cancelWorkflowRun`     | `write`    | `medium` | `true`   |
| `github.commentIssue`          | `write`    | `medium` | `true`   |
| `github.compareCommits`        | `read`     | `low`    | `false`  |
| `github.createDispatchEvent`   | `write`    | `low`    | `true`   |
| `github.createIssue`           | `write`    | `medium` | `true`   |
| `github.createLabel`           | `write`    | `low`    | `true`   |
| `github.createMilestone`       | `write`    | `low`    | `true`   |
| `github.createOrUpdateFile`    | `write`    | `medium` | `true`   |
| `github.createPullRequest`     | `write`    | `medium` | `true`   |
| `github.createReaction`        | `write`    | `low`    | `true`   |
| `github.createRelease`         | `write`    | `medium` | `true`   |
| `github.createReview`          | `write`    | `medium` | `true`   |
| `github.createReviewComment`   | `write`    | `medium` | `true`   |
| `github.deleteComment`         | `write`    | `medium` | `true`   |
| `github.deleteReaction`        | `write`    | `low`    | `true`   |
| `github.dismissReview`         | `write`    | `medium` | `true`   |
| `github.generateReleaseNotes`  | `write`    | `low`    | `true`   |
| `github.getCommitStatus`       | `read`     | `low`    | `false`  |
| `github.getFileContents`       | `read`     | `low`    | `false`  |
| `github.getIssue`              | `read`     | `low`    | `false`  |
| `github.getLatestRelease`      | `read`     | `low`    | `false`  |
| `github.getPullRequest`        | `read`     | `low`    | `false`  |
| `github.getRepo`               | `read`     | `low`    | `false`  |
| `github.getWorkflowJobLogs`    | `read`     | `low`    | `false`  |
| `github.getWorkflowRun`        | `read`     | `low`    | `false`  |
| `github.listBranches`          | `read`     | `low`    | `false`  |
| `github.listCheckRuns`         | `read`     | `low`    | `false`  |
| `github.listCommits`           | `read`     | `low`    | `false`  |
| `github.listIssueComments`     | `read`     | `low`    | `false`  |
| `github.listIssueEvents`       | `read`     | `low`    | `false`  |
| `github.listIssues`            | `read`     | `low`    | `false`  |
| `github.listIssueTimeline`     | `read`     | `low`    | `false`  |
| `github.listLabels`            | `read`     | `low`    | `false`  |
| `github.listMilestones`        | `read`     | `low`    | `false`  |
| `github.listNotifications`     | `read`     | `low`    | `false`  |
| `github.listOrgRepos`          | `read`     | `low`    | `false`  |
| `github.listPRCommits`         | `read`     | `low`    | `false`  |
| `github.listPRFiles`           | `read`     | `low`    | `false`  |
| `github.listPullRequests`      | `read`     | `low`    | `false`  |
| `github.listReleases`          | `read`     | `low`    | `false`  |
| `github.listReviews`           | `read`     | `low`    | `false`  |
| `github.listWorkflowRuns`      | `read`     | `low`    | `false`  |
| `github.lockIssue`             | `write`    | `low`    | `true`   |
| `github.markNotificationsRead` | `write`    | `low`    | `true`   |
| `github.mergePullRequest`      | `write`    | `high`   | `true`   |
| `github.removeAssignees`       | `write`    | `low`    | `true`   |
| `github.removeLabel`           | `write`    | `low`    | `true`   |
| `github.removeReviewers`       | `write`    | `low`    | `true`   |
| `github.requestReviewers`      | `write`    | `low`    | `true`   |
| `github.rerunFailedJobs`       | `write`    | `medium` | `true`   |
| `github.rerunWorkflow`         | `write`    | `medium` | `true`   |
| `github.searchCode`            | `read`     | `low`    | `false`  |
| `github.searchIssues`          | `read`     | `low`    | `false`  |
| `github.searchRepositories`    | `read`     | `low`    | `false`  |
| `github.triggerWorkflow`       | `write`    | `medium` | `true`   |
| `github.unlockIssue`           | `write`    | `low`    | `true`   |
| `github.updateComment`         | `write`    | `medium` | `true`   |
| `github.updateIssue`           | `write`    | `medium` | `true`   |
| `github.updateMilestone`       | `write`    | `low`    | `true`   |
| `github.updatePRBranch`        | `write`    | `medium` | `true`   |
| `github.updatePullRequest`     | `write`    | `medium` | `true`   |
| `github.updateRelease`         | `write`    | `medium` | `true`   |

### Google (`google`)

- Description: Google OAuth for Gmail tools
- Auth mode: `oauth2`
- Feature gate: `KEPPO_FEATURE_INTEGRATIONS_GOOGLE_FULL`
- Env requirements: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

| Tool                             | Capability | Risk     | Approval |
| -------------------------------- | ---------- | -------- | -------- |
| `gmail.applyLabel`               | `write`    | `low`    | `true`   |
| `gmail.archive`                  | `write`    | `low`    | `true`   |
| `gmail.batchModifyMessages`      | `write`    | `medium` | `true`   |
| `gmail.createDraft`              | `write`    | `medium` | `true`   |
| `gmail.createFilter`             | `write`    | `medium` | `true`   |
| `gmail.createLabel`              | `write`    | `low`    | `true`   |
| `gmail.deleteDraft`              | `write`    | `low`    | `true`   |
| `gmail.deleteFilter`             | `write`    | `medium` | `true`   |
| `gmail.deleteLabel`              | `write`    | `medium` | `true`   |
| `gmail.downloadAttachment`       | `read`     | `medium` | `false`  |
| `gmail.fetchAttachmentsMetadata` | `read`     | `medium` | `false`  |
| `gmail.fetchMessageBody`         | `read`     | `medium` | `false`  |
| `gmail.getDraft`                 | `read`     | `medium` | `false`  |
| `gmail.getFilter`                | `read`     | `low`    | `false`  |
| `gmail.getLabel`                 | `read`     | `low`    | `false`  |
| `gmail.getProfile`               | `read`     | `low`    | `false`  |
| `gmail.getSendAsAlias`           | `read`     | `low`    | `false`  |
| `gmail.getThread`                | `read`     | `medium` | `false`  |
| `gmail.getVacation`              | `read`     | `low`    | `false`  |
| `gmail.listDrafts`               | `read`     | `low`    | `false`  |
| `gmail.listFilters`              | `read`     | `low`    | `false`  |
| `gmail.listHistory`              | `read`     | `low`    | `false`  |
| `gmail.listLabels`               | `read`     | `low`    | `false`  |
| `gmail.listSendAsAliases`        | `read`     | `low`    | `false`  |
| `gmail.listUnread`               | `read`     | `low`    | `false`  |
| `gmail.removeLabel`              | `write`    | `low`    | `true`   |
| `gmail.replyToThread`            | `write`    | `high`   | `true`   |
| `gmail.searchThreads`            | `read`     | `low`    | `false`  |
| `gmail.sendDraft`                | `write`    | `high`   | `true`   |
| `gmail.sendEmail`                | `write`    | `high`   | `true`   |
| `gmail.stopWatch`                | `write`    | `low`    | `true`   |
| `gmail.trashMessage`             | `write`    | `medium` | `true`   |
| `gmail.trashThread`              | `write`    | `medium` | `true`   |
| `gmail.untrashMessage`           | `write`    | `low`    | `true`   |
| `gmail.untrashThread`            | `write`    | `low`    | `true`   |
| `gmail.updateDraft`              | `write`    | `medium` | `true`   |
| `gmail.updateLabel`              | `write`    | `low`    | `true`   |
| `gmail.updateSendAsAlias`        | `write`    | `medium` | `true`   |
| `gmail.updateVacation`           | `write`    | `medium` | `true`   |
| `gmail.watch`                    | `write`    | `medium` | `true`   |

### Notion (`notion`)

- Description: Notion page and content actions
- Auth mode: `oauth2`
- Feature gate: `KEPPO_FEATURE_INTEGRATIONS_NOTION_FULL`
- Env requirements: none

| Tool                         | Capability | Risk     | Approval |
| ---------------------------- | ---------- | -------- | -------- |
| `notion.appendBlockChildren` | `write`    | `medium` | `true`   |
| `notion.createComment`       | `write`    | `medium` | `true`   |
| `notion.createDatabase`      | `write`    | `medium` | `true`   |
| `notion.createPage`          | `write`    | `medium` | `true`   |
| `notion.deleteBlock`         | `write`    | `medium` | `true`   |
| `notion.getBlock`            | `read`     | `low`    | `false`  |
| `notion.getBlockChildren`    | `read`     | `low`    | `false`  |
| `notion.getBotUser`          | `read`     | `low`    | `false`  |
| `notion.getComment`          | `read`     | `low`    | `false`  |
| `notion.getDatabase`         | `read`     | `low`    | `false`  |
| `notion.getPage`             | `read`     | `low`    | `false`  |
| `notion.getPageAsMarkdown`   | `read`     | `low`    | `false`  |
| `notion.getPageProperty`     | `read`     | `low`    | `false`  |
| `notion.getUser`             | `read`     | `low`    | `false`  |
| `notion.listComments`        | `read`     | `low`    | `false`  |
| `notion.listUsers`           | `read`     | `low`    | `false`  |
| `notion.movePage`            | `write`    | `medium` | `true`   |
| `notion.queryDatabase`       | `read`     | `low`    | `false`  |
| `notion.searchPages`         | `read`     | `low`    | `false`  |
| `notion.updateBlock`         | `write`    | `medium` | `true`   |
| `notion.updateDatabase`      | `write`    | `medium` | `true`   |
| `notion.updatePage`          | `write`    | `medium` | `true`   |
| `notion.updatePageMarkdown`  | `write`    | `medium` | `true`   |

### Reddit (`reddit`)

- Description: Reddit actions plus native polling triggers for mentions and unread inbox mail
- Auth mode: `oauth2`
- Feature gate: `KEPPO_FEATURE_INTEGRATIONS_REDDIT_FULL`
- Env requirements: `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`

| Tool                        | Capability | Risk     | Approval |
| --------------------------- | ---------- | -------- | -------- |
| `reddit.approve`            | `write`    | `medium` | `true`   |
| `reddit.composeMessage`     | `write`    | `medium` | `true`   |
| `reddit.createComment`      | `write`    | `medium` | `true`   |
| `reddit.createPost`         | `write`    | `medium` | `true`   |
| `reddit.deletePost`         | `write`    | `medium` | `true`   |
| `reddit.distinguish`        | `write`    | `medium` | `true`   |
| `reddit.editPost`           | `write`    | `medium` | `true`   |
| `reddit.getInfo`            | `read`     | `low`    | `false`  |
| `reddit.getMe`              | `read`     | `low`    | `false`  |
| `reddit.getModLog`          | `read`     | `low`    | `false`  |
| `reddit.getModmail`         | `read`     | `low`    | `false`  |
| `reddit.getModQueue`        | `read`     | `low`    | `false`  |
| `reddit.getPostComments`    | `read`     | `low`    | `false`  |
| `reddit.getReports`         | `read`     | `low`    | `false`  |
| `reddit.getSubredditInfo`   | `read`     | `low`    | `false`  |
| `reddit.getSubredditRules`  | `read`     | `low`    | `false`  |
| `reddit.getUserAbout`       | `read`     | `low`    | `false`  |
| `reddit.getUserOverview`    | `read`     | `low`    | `false`  |
| `reddit.hidePost`           | `write`    | `low`    | `true`   |
| `reddit.listControversial`  | `read`     | `low`    | `false`  |
| `reddit.listHot`            | `read`     | `low`    | `false`  |
| `reddit.listInbox`          | `read`     | `low`    | `false`  |
| `reddit.listMentions`       | `read`     | `low`    | `false`  |
| `reddit.listModmail`        | `read`     | `low`    | `false`  |
| `reddit.listNew`            | `read`     | `low`    | `false`  |
| `reddit.listRising`         | `read`     | `low`    | `false`  |
| `reddit.listSentMessages`   | `read`     | `low`    | `false`  |
| `reddit.listTop`            | `read`     | `low`    | `false`  |
| `reddit.listUnreadMessages` | `read`     | `low`    | `false`  |
| `reddit.lockPost`           | `write`    | `medium` | `true`   |
| `reddit.markNsfw`           | `write`    | `low`    | `true`   |
| `reddit.readAllMessages`    | `write`    | `low`    | `true`   |
| `reddit.readMessage`        | `write`    | `low`    | `true`   |
| `reddit.removeContent`      | `write`    | `medium` | `true`   |
| `reddit.replyModmail`       | `write`    | `medium` | `true`   |
| `reddit.reportContent`      | `write`    | `medium` | `true`   |
| `reddit.savePost`           | `write`    | `low`    | `true`   |
| `reddit.searchPosts`        | `read`     | `low`    | `false`  |
| `reddit.searchSubreddits`   | `read`     | `low`    | `false`  |
| `reddit.selectFlair`        | `write`    | `low`    | `true`   |
| `reddit.spoiler`            | `write`    | `low`    | `true`   |
| `reddit.stickyPost`         | `write`    | `medium` | `true`   |
| `reddit.subscribe`          | `write`    | `low`    | `true`   |
| `reddit.unhidePost`         | `write`    | `low`    | `true`   |
| `reddit.unlockPost`         | `write`    | `low`    | `true`   |
| `reddit.unmarkNsfw`         | `write`    | `low`    | `true`   |
| `reddit.unsavePost`         | `write`    | `low`    | `true`   |
| `reddit.unspoiler`          | `write`    | `low`    | `true`   |
| `reddit.vote`               | `write`    | `low`    | `true`   |

### Slack (`slack`)

- Description: Slack channel and message actions
- Auth mode: `oauth2`
- Feature gate: `KEPPO_FEATURE_INTEGRATIONS_SLACK_FULL`
- Env requirements: none

| Tool                           | Capability | Risk     | Approval |
| ------------------------------ | ---------- | -------- | -------- |
| `slack.addBookmark`            | `write`    | `low`    | `true`   |
| `slack.addReaction`            | `write`    | `low`    | `true`   |
| `slack.addReminder`            | `write`    | `low`    | `true`   |
| `slack.archiveChannel`         | `write`    | `medium` | `true`   |
| `slack.closeDM`                | `write`    | `low`    | `true`   |
| `slack.createChannel`          | `write`    | `medium` | `true`   |
| `slack.deleteFile`             | `write`    | `medium` | `true`   |
| `slack.deleteMessage`          | `write`    | `medium` | `true`   |
| `slack.deleteReminder`         | `write`    | `low`    | `true`   |
| `slack.deleteScheduledMessage` | `write`    | `low`    | `true`   |
| `slack.editBookmark`           | `write`    | `low`    | `true`   |
| `slack.getChannelHistory`      | `read`     | `low`    | `false`  |
| `slack.getChannelInfo`         | `read`     | `low`    | `false`  |
| `slack.getFileInfo`            | `read`     | `low`    | `false`  |
| `slack.getPermalink`           | `read`     | `low`    | `false`  |
| `slack.getReactions`           | `read`     | `low`    | `false`  |
| `slack.getThreadReplies`       | `read`     | `low`    | `false`  |
| `slack.getUserInfo`            | `read`     | `low`    | `false`  |
| `slack.getUserPresence`        | `read`     | `low`    | `false`  |
| `slack.getUserProfile`         | `read`     | `low`    | `false`  |
| `slack.inviteToChannel`        | `write`    | `medium` | `true`   |
| `slack.joinChannel`            | `write`    | `low`    | `true`   |
| `slack.kickFromChannel`        | `write`    | `medium` | `true`   |
| `slack.leaveChannel`           | `write`    | `low`    | `true`   |
| `slack.listBookmarks`          | `read`     | `low`    | `false`  |
| `slack.listChannelMembers`     | `read`     | `low`    | `false`  |
| `slack.listChannels`           | `read`     | `low`    | `false`  |
| `slack.listFiles`              | `read`     | `low`    | `false`  |
| `slack.listPins`               | `read`     | `low`    | `false`  |
| `slack.listReactions`          | `read`     | `low`    | `false`  |
| `slack.listReminders`          | `read`     | `low`    | `false`  |
| `slack.listScheduledMessages`  | `read`     | `low`    | `false`  |
| `slack.listUserGroupMembers`   | `read`     | `low`    | `false`  |
| `slack.listUserGroups`         | `read`     | `low`    | `false`  |
| `slack.listUsers`              | `read`     | `low`    | `false`  |
| `slack.markChannelRead`        | `write`    | `low`    | `true`   |
| `slack.meMessage`              | `write`    | `low`    | `true`   |
| `slack.openDM`                 | `write`    | `low`    | `true`   |
| `slack.pinMessage`             | `write`    | `low`    | `true`   |
| `slack.postEphemeral`          | `write`    | `low`    | `true`   |
| `slack.postMessage`            | `write`    | `medium` | `true`   |
| `slack.removeBookmark`         | `write`    | `low`    | `true`   |
| `slack.removeReaction`         | `write`    | `low`    | `true`   |
| `slack.renameChannel`          | `write`    | `medium` | `true`   |
| `slack.scheduleMessage`        | `write`    | `medium` | `true`   |
| `slack.searchFiles`            | `read`     | `low`    | `false`  |
| `slack.searchMessages`         | `read`     | `low`    | `false`  |
| `slack.setChannelPurpose`      | `write`    | `low`    | `true`   |
| `slack.setChannelTopic`        | `write`    | `low`    | `true`   |
| `slack.unarchiveChannel`       | `write`    | `medium` | `true`   |
| `slack.unpinMessage`           | `write`    | `low`    | `true`   |
| `slack.updateMessage`          | `write`    | `medium` | `true`   |
| `slack.uploadFile`             | `write`    | `medium` | `true`   |

### Stripe (`stripe`)

- Description: Stripe customer and billing actions
- Auth mode: `oauth2`
- Feature gate: `KEPPO_FEATURE_INTEGRATIONS_STRIPE_FULL`
- Env requirements: `STRIPE_CLIENT_ID`, `STRIPE_SECRET_KEY`, `STRIPE_PROVIDER_WEBHOOK_SECRET`

| Tool                                   | Capability | Risk       | Approval |
| -------------------------------------- | ---------- | ---------- | -------- |
| `stripe.adjustBalance`                 | `write`    | `high`     | `true`   |
| `stripe.cancelRefund`                  | `write`    | `medium`   | `true`   |
| `stripe.cancelSubscription`            | `write`    | `high`     | `true`   |
| `stripe.cancelSubscriptionSchedule`    | `write`    | `high`     | `true`   |
| `stripe.closeDispute`                  | `write`    | `high`     | `true`   |
| `stripe.createCheckoutSession`         | `write`    | `medium`   | `true`   |
| `stripe.createCoupon`                  | `write`    | `medium`   | `true`   |
| `stripe.createCreditNote`              | `write`    | `high`     | `true`   |
| `stripe.createCustomerTaxId`           | `write`    | `medium`   | `true`   |
| `stripe.createInvoice`                 | `write`    | `high`     | `true`   |
| `stripe.createInvoiceItem`             | `write`    | `medium`   | `true`   |
| `stripe.createPortalSession`           | `write`    | `medium`   | `true`   |
| `stripe.createPromotionCode`           | `write`    | `medium`   | `true`   |
| `stripe.createSetupIntent`             | `write`    | `medium`   | `true`   |
| `stripe.createSubscription`            | `write`    | `high`     | `true`   |
| `stripe.createSubscriptionItem`        | `write`    | `high`     | `true`   |
| `stripe.deleteCustomerDiscount`        | `write`    | `medium`   | `true`   |
| `stripe.deleteCustomerTaxId`           | `write`    | `medium`   | `true`   |
| `stripe.deleteInvoiceItem`             | `write`    | `medium`   | `true`   |
| `stripe.deleteSubscriptionDiscount`    | `write`    | `medium`   | `true`   |
| `stripe.deleteSubscriptionItem`        | `write`    | `high`     | `true`   |
| `stripe.detachPaymentMethod`           | `write`    | `medium`   | `true`   |
| `stripe.finalizeInvoice`               | `write`    | `high`     | `true`   |
| `stripe.getBalanceTransaction`         | `read`     | `low`      | `false`  |
| `stripe.getCharge`                     | `read`     | `low`      | `false`  |
| `stripe.getCheckoutSession`            | `read`     | `low`      | `false`  |
| `stripe.getCoupon`                     | `read`     | `low`      | `false`  |
| `stripe.getCreditNote`                 | `read`     | `low`      | `false`  |
| `stripe.getDispute`                    | `read`     | `low`      | `false`  |
| `stripe.getEvent`                      | `read`     | `low`      | `false`  |
| `stripe.getInvoice`                    | `read`     | `low`      | `false`  |
| `stripe.getPaymentIntent`              | `read`     | `low`      | `false`  |
| `stripe.getPrice`                      | `read`     | `low`      | `false`  |
| `stripe.getProduct`                    | `read`     | `low`      | `false`  |
| `stripe.getPromotionCode`              | `read`     | `low`      | `false`  |
| `stripe.getRefund`                     | `read`     | `low`      | `false`  |
| `stripe.getSubscription`               | `read`     | `low`      | `false`  |
| `stripe.getSubscriptionSchedule`       | `read`     | `low`      | `false`  |
| `stripe.invoiceHistory`                | `read`     | `medium`   | `false`  |
| `stripe.issueRefund`                   | `write`    | `critical` | `true`   |
| `stripe.listBalanceTransactions`       | `read`     | `low`      | `false`  |
| `stripe.listCharges`                   | `read`     | `medium`   | `false`  |
| `stripe.listCoupons`                   | `read`     | `low`      | `false`  |
| `stripe.listCreditNotes`               | `read`     | `low`      | `false`  |
| `stripe.listCustomerTaxIds`            | `read`     | `low`      | `false`  |
| `stripe.listDisputes`                  | `read`     | `low`      | `false`  |
| `stripe.listEvents`                    | `read`     | `low`      | `false`  |
| `stripe.listGlobalBalanceTransactions` | `read`     | `low`      | `false`  |
| `stripe.listPaymentIntents`            | `read`     | `low`      | `false`  |
| `stripe.listPaymentMethods`            | `read`     | `low`      | `false`  |
| `stripe.listPrices`                    | `read`     | `low`      | `false`  |
| `stripe.listProducts`                  | `read`     | `low`      | `false`  |
| `stripe.listPromotionCodes`            | `read`     | `low`      | `false`  |
| `stripe.listRefunds`                   | `read`     | `low`      | `false`  |
| `stripe.listSubscriptionItems`         | `read`     | `low`      | `false`  |
| `stripe.listSubscriptions`             | `read`     | `low`      | `false`  |
| `stripe.listSubscriptionSchedules`     | `read`     | `low`      | `false`  |
| `stripe.lookupCustomer`                | `read`     | `low`      | `false`  |
| `stripe.markUncollectible`             | `write`    | `high`     | `true`   |
| `stripe.payInvoice`                    | `write`    | `high`     | `true`   |
| `stripe.previewCreditNote`             | `read`     | `low`      | `false`  |
| `stripe.previewInvoice`                | `read`     | `low`      | `false`  |
| `stripe.resumeSubscription`            | `write`    | `medium`   | `true`   |
| `stripe.searchCharges`                 | `read`     | `low`      | `false`  |
| `stripe.searchCustomers`               | `read`     | `low`      | `false`  |
| `stripe.searchInvoices`                | `read`     | `low`      | `false`  |
| `stripe.searchPaymentIntents`          | `read`     | `low`      | `false`  |
| `stripe.searchSubscriptions`           | `read`     | `low`      | `false`  |
| `stripe.sendInvoice`                   | `write`    | `medium`   | `true`   |
| `stripe.updateCharge`                  | `write`    | `low`      | `true`   |
| `stripe.updateCustomer`                | `write`    | `medium`   | `true`   |
| `stripe.updateDispute`                 | `write`    | `high`     | `true`   |
| `stripe.updateRefund`                  | `write`    | `low`      | `true`   |
| `stripe.updateSubscription`            | `write`    | `high`     | `true`   |
| `stripe.updateSubscriptionItem`        | `write`    | `high`     | `true`   |
| `stripe.updateSubscriptionSchedule`    | `write`    | `high`     | `true`   |
| `stripe.voidCreditNote`                | `write`    | `high`     | `true`   |
| `stripe.voidInvoice`                   | `write`    | `high`     | `true`   |

### X (`x`)

- Description: X actions plus native polling triggers for mentions
- Auth mode: `oauth2`
- Feature gate: `KEPPO_FEATURE_INTEGRATIONS_X_FULL`
- Env requirements: `X_CLIENT_ID`, `X_CLIENT_SECRET`

| Tool                     | Capability | Risk     | Approval |
| ------------------------ | ---------- | -------- | -------- |
| `x.addListMember`        | `write`    | `low`    | `true`   |
| `x.blockUser`            | `write`    | `medium` | `true`   |
| `x.createBookmark`       | `write`    | `low`    | `true`   |
| `x.createDMConversation` | `write`    | `medium` | `true`   |
| `x.createList`           | `write`    | `low`    | `true`   |
| `x.createPost`           | `write`    | `medium` | `true`   |
| `x.deleteBookmark`       | `write`    | `low`    | `true`   |
| `x.deleteList`           | `write`    | `low`    | `true`   |
| `x.deletePost`           | `write`    | `medium` | `true`   |
| `x.followUser`           | `write`    | `low`    | `true`   |
| `x.getBlockedUsers`      | `read`     | `low`    | `false`  |
| `x.getBookmarks`         | `read`     | `low`    | `false`  |
| `x.getDMEvents`          | `read`     | `low`    | `false`  |
| `x.getFollowers`         | `read`     | `low`    | `false`  |
| `x.getFollowing`         | `read`     | `low`    | `false`  |
| `x.getHomeTimeline`      | `read`     | `low`    | `false`  |
| `x.getLikedPosts`        | `read`     | `low`    | `false`  |
| `x.getLikingUsers`       | `read`     | `low`    | `false`  |
| `x.getList`              | `read`     | `low`    | `false`  |
| `x.getListMembers`       | `read`     | `low`    | `false`  |
| `x.getListTweets`        | `read`     | `low`    | `false`  |
| `x.getMe`                | `read`     | `low`    | `false`  |
| `x.getMutedUsers`        | `read`     | `low`    | `false`  |
| `x.getOwnedLists`        | `read`     | `low`    | `false`  |
| `x.getPost`              | `read`     | `low`    | `false`  |
| `x.getPostCounts`        | `read`     | `low`    | `false`  |
| `x.getPosts`             | `read`     | `low`    | `false`  |
| `x.getQuoteTweets`       | `read`     | `low`    | `false`  |
| `x.getRepostedBy`        | `read`     | `low`    | `false`  |
| `x.getUserById`          | `read`     | `low`    | `false`  |
| `x.getUserByUsername`    | `read`     | `low`    | `false`  |
| `x.getUserMentions`      | `read`     | `low`    | `false`  |
| `x.getUsersByUsernames`  | `read`     | `low`    | `false`  |
| `x.getUserTimeline`      | `read`     | `low`    | `false`  |
| `x.likePost`             | `write`    | `low`    | `true`   |
| `x.muteUser`             | `write`    | `low`    | `true`   |
| `x.removeListMember`     | `write`    | `low`    | `true`   |
| `x.repost`               | `write`    | `low`    | `true`   |
| `x.searchAllPosts`       | `read`     | `low`    | `false`  |
| `x.searchPosts`          | `read`     | `low`    | `false`  |
| `x.searchUsers`          | `read`     | `low`    | `false`  |
| `x.sendDM`               | `write`    | `medium` | `true`   |
| `x.unblockUser`          | `write`    | `low`    | `true`   |
| `x.undoRepost`           | `write`    | `low`    | `true`   |
| `x.unfollowUser`         | `write`    | `low`    | `true`   |
| `x.unlikePost`           | `write`    | `low`    | `true`   |
| `x.unmuteUser`           | `write`    | `low`    | `true`   |
| `x.updateList`           | `write`    | `low`    | `true`   |

## Extension Workflow

1. Add/update provider tools in `packages/shared/src/tool-definitions.ts`.
2. Add/update provider runtime metadata and hooks in `packages/shared/src/providers.ts` (capabilities, auth mode, feature gate, env requirements, tool ownership).
3. Add/update provider default scopes in `packages/shared/src/provider-default-scopes.ts`.
4. Add/update provider dashboard detail UI contract in `packages/shared/src/providers-ui.ts` (action form, serializer, metadata editors).
5. Run `pnpm run check:provider-guardrails`, `pnpm run check:provider-registry-snapshot`, and `pnpm run update:provider-docs`.

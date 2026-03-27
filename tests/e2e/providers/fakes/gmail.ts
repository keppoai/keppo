import {
  createFakeGmailClientStore,
  createFakeGmailSdk,
  type FakeGmailClientStore,
} from "../../../../packages/shared/src/provider-sdk/google/fake.js";
import { BaseProviderFake } from "../base-fake";
import type { ProviderReadRequest, ProviderWriteRequest } from "../contract/provider-contract";

const defaultFakeToken = (): string =>
  process.env.KEPPO_FAKE_GMAIL_ACCESS_TOKEN ?? "fake_gmail_access_token";

const parseJsonBody = (input: unknown): Record<string, unknown> => {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input === "string" && input.trim().length > 0) {
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
};

export class GmailFake extends BaseProviderFake {
  private readonly clientStore: FakeGmailClientStore = createFakeGmailClientStore();
  private readonly sdk = createFakeGmailSdk({ clientStore: this.clientStore });

  override assertAccessToken(namespace: string, accessToken: string | null): void {
    if (accessToken === defaultFakeToken()) {
      return;
    }
    super.assertAccessToken(namespace, accessToken);
  }

  override async getProfile(namespace: string): Promise<Record<string, unknown>> {
    return await this.sdk.getProfile({
      accessToken: defaultFakeToken(),
      namespace,
    });
  }

  override async listResources(request: ProviderReadRequest): Promise<Record<string, unknown>> {
    if (request.resource === "messages") {
      return await this.sdk.listMessages({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        query: request.query.q ?? "",
        maxResults: Number(request.query.maxResults ?? "20") || 20,
      });
    }

    if (request.resource === "labels") {
      return await this.sdk.listLabels({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
      });
    }

    if (request.resource === "drafts") {
      return await this.sdk.listDrafts({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        maxResults: Number(request.query.maxResults ?? "20") || 20,
      });
    }

    if (request.resource === "history") {
      return await this.sdk.listHistory({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        startHistoryId: String(request.query.startHistoryId ?? "0"),
        maxResults: Number(request.query.maxResults ?? "20") || 20,
        ...(typeof request.query.labelId === "string" ? { labelId: request.query.labelId } : {}),
      });
    }

    if (request.resource === "settings/filters") {
      return await this.sdk.listFilters({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
      });
    }

    if (request.resource === "settings/sendAs") {
      return await this.sdk.listSendAsAliases({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
      });
    }

    throw new Error(`unsupported_resource:${request.resource}`);
  }

  override async readResource(request: ProviderReadRequest): Promise<Record<string, unknown>> {
    if (request.resource.startsWith("messages/") && request.resource.includes("/attachments/")) {
      const [messagePart, attachmentPart] = request.resource.split("/attachments/");
      const messageId = decodeURIComponent(messagePart.replace("messages/", ""));
      const attachmentId = decodeURIComponent(attachmentPart ?? "");
      return await this.sdk.downloadAttachment({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        messageId,
        attachmentId,
      });
    }

    if (request.resource.startsWith("messages/")) {
      const id = decodeURIComponent(request.resource.replace("messages/", ""));
      return await this.sdk.getMessage({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        messageId: id,
        format: "full",
      });
    }

    if (request.resource.startsWith("threads/")) {
      const id = decodeURIComponent(request.resource.replace("threads/", ""));
      return await this.sdk.getThread({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        threadId: id,
        format: "full",
      });
    }

    if (request.resource.startsWith("drafts/")) {
      const id = decodeURIComponent(request.resource.replace("drafts/", ""));
      return await this.sdk.getDraft({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        draftId: id,
        format: "full",
      });
    }

    if (request.resource.startsWith("labels/")) {
      const id = decodeURIComponent(request.resource.replace("labels/", ""));
      return await this.sdk.getLabel({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        labelId: id,
      });
    }

    if (request.resource.startsWith("settings/filters/")) {
      const id = decodeURIComponent(request.resource.replace("settings/filters/", ""));
      return await this.sdk.getFilter({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        filterId: id,
      });
    }

    if (request.resource.startsWith("settings/sendAs/")) {
      const sendAsEmail = decodeURIComponent(request.resource.replace("settings/sendAs/", ""));
      return await this.sdk.getSendAsAlias({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        sendAsEmail,
      });
    }

    if (request.resource === "settings/vacation") {
      return await this.sdk.getVacation({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
      });
    }

    throw new Error(`unsupported_resource:${request.resource}`);
  }

  override async writeResource(request: ProviderWriteRequest): Promise<Record<string, unknown>> {
    if (request.resource === "messages/send") {
      const body = parseJsonBody(request.body);
      return await this.sdk.sendMessage({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        raw: String(body.raw ?? ""),
        ...(typeof body.threadId === "string" ? { threadId: body.threadId } : {}),
        idempotencyKey:
          request.headers.get("x-idempotency-key") ??
          request.headers.get("Idempotency-Key") ??
          undefined,
      });
    }

    if (request.resource.startsWith("threads/") && request.resource.endsWith("/modify")) {
      const threadId = request.resource.replace("threads/", "").replace("/modify", "");
      const body = parseJsonBody(request.body);
      return await this.sdk.modifyThread({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        threadId,
        addLabelIds: Array.isArray(body.addLabelIds)
          ? body.addLabelIds.map((value) => String(value))
          : undefined,
        removeLabelIds: Array.isArray(body.removeLabelIds)
          ? body.removeLabelIds.map((value) => String(value))
          : undefined,
        idempotencyKey:
          request.headers.get("x-idempotency-key") ??
          request.headers.get("Idempotency-Key") ??
          undefined,
      });
    }

    if (request.resource.startsWith("threads/") && request.resource.endsWith("/trash")) {
      const threadId = request.resource.replace("threads/", "").replace("/trash", "");
      return await this.sdk.trashThread({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        threadId,
        idempotencyKey:
          request.headers.get("x-idempotency-key") ??
          request.headers.get("Idempotency-Key") ??
          undefined,
      });
    }

    if (request.resource.startsWith("threads/") && request.resource.endsWith("/untrash")) {
      const threadId = request.resource.replace("threads/", "").replace("/untrash", "");
      return await this.sdk.untrashThread({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        threadId,
        idempotencyKey:
          request.headers.get("x-idempotency-key") ??
          request.headers.get("Idempotency-Key") ??
          undefined,
      });
    }

    if (request.resource.startsWith("messages/") && request.resource.endsWith("/trash")) {
      const messageId = request.resource.replace("messages/", "").replace("/trash", "");
      return await this.sdk.trashMessage({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        messageId,
        idempotencyKey:
          request.headers.get("x-idempotency-key") ??
          request.headers.get("Idempotency-Key") ??
          undefined,
      });
    }

    if (request.resource.startsWith("messages/") && request.resource.endsWith("/untrash")) {
      const messageId = request.resource.replace("messages/", "").replace("/untrash", "");
      return await this.sdk.untrashMessage({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        messageId,
        idempotencyKey:
          request.headers.get("x-idempotency-key") ??
          request.headers.get("Idempotency-Key") ??
          undefined,
      });
    }

    if (request.resource === "labels") {
      const body = parseJsonBody(request.body);
      return await this.sdk.createLabel({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        name: String(body.name ?? ""),
        ...(typeof body.labelListVisibility === "string"
          ? { labelListVisibility: body.labelListVisibility }
          : {}),
        ...(typeof body.messageListVisibility === "string"
          ? { messageListVisibility: body.messageListVisibility }
          : {}),
        idempotencyKey:
          request.headers.get("x-idempotency-key") ??
          request.headers.get("Idempotency-Key") ??
          undefined,
      });
    }

    if (request.resource.startsWith("labels/")) {
      if (request.resource.endsWith("/delete")) {
        const labelId = decodeURIComponent(
          request.resource.replace("labels/", "").replace("/delete", ""),
        );
        return await this.sdk.deleteLabel({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          labelId,
          idempotencyKey:
            request.headers.get("x-idempotency-key") ??
            request.headers.get("Idempotency-Key") ??
            undefined,
        });
      }
      const labelId = decodeURIComponent(request.resource.replace("labels/", ""));

      const body = parseJsonBody(request.body);
      return await this.sdk.updateLabel({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        labelId,
        ...(typeof body.name === "string" ? { name: body.name } : {}),
        ...(typeof body.labelListVisibility === "string"
          ? { labelListVisibility: body.labelListVisibility }
          : {}),
        ...(typeof body.messageListVisibility === "string"
          ? { messageListVisibility: body.messageListVisibility }
          : {}),
        idempotencyKey:
          request.headers.get("x-idempotency-key") ??
          request.headers.get("Idempotency-Key") ??
          undefined,
      });
    }

    if (request.resource === "drafts") {
      const body = parseJsonBody(request.body);
      const message = parseJsonBody(body.message);
      return await this.sdk.createDraft({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        raw: String(message.raw ?? ""),
        ...(typeof message.threadId === "string" ? { threadId: message.threadId } : {}),
        idempotencyKey:
          request.headers.get("x-idempotency-key") ??
          request.headers.get("Idempotency-Key") ??
          undefined,
      });
    }

    if (request.resource === "settings/filters") {
      const body = parseJsonBody(request.body);
      const criteria = parseJsonBody(body.criteria);
      const action = parseJsonBody(body.action);
      return await this.sdk.createFilter({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        criteria: {
          ...(typeof criteria.from === "string" ? { from: criteria.from } : {}),
          ...(typeof criteria.to === "string" ? { to: criteria.to } : {}),
          ...(typeof criteria.subject === "string" ? { subject: criteria.subject } : {}),
          ...(typeof criteria.query === "string" ? { query: criteria.query } : {}),
          ...(typeof criteria.negatedQuery === "string"
            ? { negatedQuery: criteria.negatedQuery }
            : {}),
          ...(typeof criteria.hasAttachment === "boolean"
            ? { hasAttachment: criteria.hasAttachment }
            : {}),
          ...(criteria.sizeComparison === "larger" || criteria.sizeComparison === "smaller"
            ? { sizeComparison: criteria.sizeComparison }
            : {}),
          ...(typeof criteria.size === "number" ? { size: criteria.size } : {}),
        },
        action: {
          ...(Array.isArray(action.addLabelIds)
            ? { addLabelIds: action.addLabelIds.map((value) => String(value)) }
            : {}),
          ...(Array.isArray(action.removeLabelIds)
            ? { removeLabelIds: action.removeLabelIds.map((value) => String(value)) }
            : {}),
          ...(typeof action.forward === "string" ? { forward: action.forward } : {}),
        },
        idempotencyKey:
          request.headers.get("x-idempotency-key") ??
          request.headers.get("Idempotency-Key") ??
          undefined,
      });
    }

    if (request.resource.startsWith("drafts/") && request.resource.endsWith("/delete")) {
      const draftId = request.resource.replace("drafts/", "").replace("/delete", "");
      return await this.sdk.deleteDraft({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        draftId,
        idempotencyKey:
          request.headers.get("x-idempotency-key") ??
          request.headers.get("Idempotency-Key") ??
          undefined,
      });
    }

    if (request.resource.startsWith("drafts/") && request.resource !== "drafts/send") {
      const draftId = request.resource.replace("drafts/", "");
      const body = parseJsonBody(request.body);
      const message = parseJsonBody(body.message);
      return await this.sdk.updateDraft({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        draftId,
        raw: String(message.raw ?? ""),
        ...(typeof message.threadId === "string" ? { threadId: message.threadId } : {}),
        idempotencyKey:
          request.headers.get("x-idempotency-key") ??
          request.headers.get("Idempotency-Key") ??
          undefined,
      });
    }

    if (request.resource === "drafts/send") {
      const body = parseJsonBody(request.body);
      return await this.sdk.sendDraft({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        draftId: String(body.id ?? body.draftId ?? ""),
        idempotencyKey:
          request.headers.get("x-idempotency-key") ??
          request.headers.get("Idempotency-Key") ??
          undefined,
      });
    }

    if (request.resource.startsWith("settings/filters/")) {
      const filterId = request.resource.replace("settings/filters/", "");
      return await this.sdk.deleteFilter({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        filterId,
        idempotencyKey:
          request.headers.get("x-idempotency-key") ??
          request.headers.get("Idempotency-Key") ??
          undefined,
      });
    }

    if (request.resource.startsWith("settings/sendAs/")) {
      const sendAsEmail = decodeURIComponent(request.resource.replace("settings/sendAs/", ""));
      const body = parseJsonBody(request.body);
      return await this.sdk.updateSendAsAlias({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        sendAsEmail,
        ...(typeof body.displayName === "string" ? { displayName: body.displayName } : {}),
        ...(typeof body.replyToAddress === "string" ? { replyToAddress: body.replyToAddress } : {}),
        ...(typeof body.signature === "string" ? { signature: body.signature } : {}),
        ...(typeof body.treatAsAlias === "boolean" ? { treatAsAlias: body.treatAsAlias } : {}),
        idempotencyKey:
          request.headers.get("x-idempotency-key") ??
          request.headers.get("Idempotency-Key") ??
          undefined,
      });
    }

    if (request.resource === "settings/vacation") {
      const body = parseJsonBody(request.body);
      return await this.sdk.updateVacation({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        vacation: {
          enableAutoReply: Boolean(body.enableAutoReply),
          responseSubject: String(body.responseSubject ?? ""),
          responseBodyPlainText: String(body.responseBodyPlainText ?? ""),
          responseBodyHtml: String(body.responseBodyHtml ?? ""),
          restrictToContacts: Boolean(body.restrictToContacts),
          restrictToDomain: Boolean(body.restrictToDomain),
          ...(typeof body.startTime === "string" ? { startTime: body.startTime } : {}),
          ...(typeof body.endTime === "string" ? { endTime: body.endTime } : {}),
        },
        idempotencyKey:
          request.headers.get("x-idempotency-key") ??
          request.headers.get("Idempotency-Key") ??
          undefined,
      });
    }

    if (request.resource === "messages/batchModify") {
      const body = parseJsonBody(request.body);
      return await this.sdk.batchModifyMessages({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        messageIds: Array.isArray(body.ids) ? body.ids.map((value) => String(value)) : [],
        addLabelIds: Array.isArray(body.addLabelIds)
          ? body.addLabelIds.map((value) => String(value))
          : undefined,
        removeLabelIds: Array.isArray(body.removeLabelIds)
          ? body.removeLabelIds.map((value) => String(value))
          : undefined,
        idempotencyKey:
          request.headers.get("x-idempotency-key") ??
          request.headers.get("Idempotency-Key") ??
          undefined,
      });
    }

    if (request.resource === "watch") {
      const body = parseJsonBody(request.body);
      return await this.sdk.watch({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        topicName: String(body.topicName ?? ""),
        labelIds: Array.isArray(body.labelIds) ? body.labelIds.map((value) => String(value)) : [],
        labelFilterBehavior: body.labelFilterBehavior === "exclude" ? "exclude" : "include",
        idempotencyKey:
          request.headers.get("x-idempotency-key") ??
          request.headers.get("Idempotency-Key") ??
          undefined,
      });
    }

    if (request.resource === "stop") {
      return await this.sdk.stopWatch({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        idempotencyKey:
          request.headers.get("x-idempotency-key") ??
          request.headers.get("Idempotency-Key") ??
          undefined,
      });
    }

    throw new Error(`unsupported_resource:${request.resource}`);
  }

  override reset(namespace?: string): void {
    super.reset(namespace);
    this.clientStore.reset(namespace);
  }

  override seed(namespace: string, seedData: Record<string, unknown>): void {
    super.seed(namespace, seedData);
    this.clientStore.seed(namespace, seedData);
  }

  getSdkCalls(namespace?: string): Array<Record<string, unknown>> {
    return this.sdk.callLog.list(namespace);
  }
}

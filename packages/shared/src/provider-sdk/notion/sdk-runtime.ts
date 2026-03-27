import { isFullPage, type BlockObjectRequest, type PageObjectResponse } from "@notionhq/client";
import type { ProviderSdkCallLog, ProviderSdkRuntime } from "../port.js";
import { BaseSdkPort } from "../base-sdk.js";
import { asRecord } from "../client-adapter-utils.js";
import type { CreateNotionClient } from "./client-interface.js";
import { toProviderSdkError } from "./errors.js";
import type {
  NotionAppendBlockChildrenArgs,
  NotionBlock,
  NotionComment,
  NotionCreateCommentArgs,
  NotionCreateDatabaseArgs,
  NotionCreatePageArgs,
  NotionCreatePageResponse,
  NotionDeleteBlockArgs,
  NotionDatabase,
  NotionGetBlockArgs,
  NotionGetBlockChildrenArgs,
  NotionGetDatabaseArgs,
  NotionGetCommentArgs,
  NotionGetPageArgs,
  NotionGetPageAsMarkdownArgs,
  NotionGetPagePropertyArgs,
  NotionGetUserArgs,
  NotionListCommentsArgs,
  NotionListUsersArgs,
  NotionPage,
  NotionPageMarkdown,
  NotionPageProperty,
  NotionQueryDatabaseArgs,
  NotionSdkPort,
  NotionSearchPagesArgs,
  NotionUpdateBlockArgs,
  NotionUpdateDatabaseArgs,
  NotionUpdatePageMarkdownArgs,
  NotionUpdatePageMarkdownResponse,
  NotionMovePageArgs,
  NotionUpdatePageArgs,
  NotionUser,
} from "./types.js";

const parseTitleValue = (value: unknown): string => {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return "";
      }
      const item = entry as Record<string, unknown>;
      if (typeof item.plain_text === "string") {
        return item.plain_text;
      }
      const textValue =
        item.text && typeof item.text === "object" && !Array.isArray(item.text)
          ? (item.text as Record<string, unknown>).content
          : null;
      return typeof textValue === "string" ? textValue : "";
    })
    .join("")
    .trim();
};

const parseRichTextValue = (value: unknown): string => {
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return "";
      }
      const record = entry as Record<string, unknown>;
      if (typeof record.plain_text === "string") {
        return record.plain_text;
      }
      const textRecord = asRecord(record.text);
      return typeof textRecord.content === "string" ? textRecord.content : "";
    })
    .join("")
    .trim();
};

const readNotionTitle = (page: PageObjectResponse): string => {
  const properties =
    page &&
    typeof page === "object" &&
    "properties" in page &&
    page.properties &&
    typeof page.properties === "object" &&
    !Array.isArray(page.properties)
      ? (page.properties as Record<string, unknown>)
      : {};

  for (const property of Object.values(properties)) {
    if (!property || typeof property !== "object" || Array.isArray(property)) {
      continue;
    }
    const maybeProperty = property as { type?: string; title?: unknown };
    if (maybeProperty.type !== "title") {
      continue;
    }

    const fromTitle = parseTitleValue(maybeProperty.title);
    if (fromTitle) {
      return fromTitle;
    }
  }

  return "Untitled";
};

const toNotionPage = (value: unknown): NotionPage | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const notionEntry = value as Parameters<typeof isFullPage>[0];
  if (isFullPage(notionEntry)) {
    const parent =
      notionEntry.parent &&
      typeof notionEntry.parent === "object" &&
      "page_id" in notionEntry.parent &&
      typeof notionEntry.parent.page_id === "string"
        ? notionEntry.parent.page_id
        : undefined;
    return {
      id: notionEntry.id,
      title: readNotionTitle(notionEntry),
      archived: notionEntry.archived,
      ...(parent ? { parentPageId: parent } : {}),
      properties: notionEntry.properties as Record<string, unknown>,
      ...(notionEntry.url ? { url: notionEntry.url } : {}),
    };
  }

  const entry = value as Record<string, unknown>;
  const simplifiedId = String(entry.id ?? "").trim();
  const simplifiedTitle = typeof entry.title === "string" ? entry.title.trim() : "";
  if (simplifiedId && simplifiedTitle) {
    return {
      id: simplifiedId,
      title: simplifiedTitle,
      ...(typeof entry.content === "string" ? { content: entry.content } : {}),
      ...(typeof entry.archived === "boolean" ? { archived: entry.archived } : {}),
      ...(entry.properties &&
      typeof entry.properties === "object" &&
      !Array.isArray(entry.properties)
        ? { properties: entry.properties as Record<string, unknown> }
        : {}),
      ...(typeof entry.url === "string" ? { url: entry.url } : {}),
    };
  }

  if (entry.object !== "page") {
    return null;
  }

  if (!simplifiedId) {
    return null;
  }

  return {
    id: simplifiedId,
    title: "Untitled",
    ...(typeof asRecord(entry.parent).page_id === "string"
      ? { parentPageId: asRecord(entry.parent).page_id as string }
      : {}),
    ...(typeof entry.archived === "boolean" ? { archived: entry.archived } : {}),
    ...(entry.properties && typeof entry.properties === "object" && !Array.isArray(entry.properties)
      ? { properties: entry.properties as Record<string, unknown> }
      : {}),
  };
};

const toNotionDatabase = (value: unknown): NotionDatabase | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const id = String(entry.id ?? "").trim();
  if (!id) {
    return null;
  }

  let title = "";
  if (typeof entry.title === "string") {
    title = entry.title.trim();
  } else if (Array.isArray(entry.title)) {
    title = parseTitleValue(entry.title);
  }
  if (!title) {
    title = "Untitled Database";
  }

  const properties = asRecord(entry.properties);
  const parent = asRecord(entry.parent);
  return {
    id,
    title,
    propertyKeys: Object.keys(properties),
    ...(typeof parent.page_id === "string" ? { parentPageId: parent.page_id } : {}),
    ...(typeof entry.url === "string" ? { url: entry.url } : {}),
  };
};

const toNotionBlock = (value: unknown): NotionBlock | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const id = String(entry.id ?? "").trim();
  const type = String(entry.type ?? "").trim();
  if (!id || !type) {
    return null;
  }

  let text = "";
  if (typeof entry.text === "string") {
    text = entry.text;
  } else {
    const blockTypePayload = asRecord(entry[type]);
    text = parseRichTextValue(blockTypePayload.rich_text);
  }

  return {
    id,
    type,
    hasChildren: Boolean(entry.has_children ?? entry.hasChildren ?? false),
    ...(typeof entry.archived === "boolean" ? { archived: entry.archived } : {}),
    ...(text ? { text } : {}),
  };
};

const toNotionComment = (value: unknown, fallbackPageId?: string): NotionComment | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const id = String(entry.id ?? "").trim();
  if (!id) {
    return null;
  }

  const parent = asRecord(entry.parent);
  const pageIdRaw = parent.page_id ?? entry.pageId ?? entry.page_id ?? fallbackPageId ?? "";
  const pageId = String(pageIdRaw).trim();
  if (!pageId) {
    return null;
  }

  const richTextValue = parseRichTextValue(entry.rich_text);
  const contentRaw = typeof entry.content === "string" ? entry.content : richTextValue;
  const content = String(contentRaw ?? "").trim();

  const createdBy = asRecord(entry.created_by);
  const createdById =
    typeof createdBy.id === "string"
      ? createdBy.id
      : typeof entry.createdBy === "string"
        ? entry.createdBy
        : undefined;

  return {
    id,
    pageId,
    content,
    ...(createdById ? { createdBy: createdById } : {}),
  };
};

const createParagraphChildren = (content: string): BlockObjectRequest[] => {
  if (!content.trim()) {
    return [];
  }

  return [
    {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          {
            type: "text",
            text: {
              content,
            },
          },
        ],
      },
    },
  ];
};

const buildNotionRichText = (
  content: string,
): Array<{
  type: "text";
  text: {
    content: string;
  };
}> => {
  return [
    {
      type: "text",
      text: {
        content,
      },
    },
  ];
};

const toMarkdownFromBlocks = (blocks: NotionBlock[], fallbackContent?: string): string => {
  const markdown = blocks
    .map((block) => (typeof block.text === "string" ? block.text.trim() : ""))
    .filter((text) => text.length > 0)
    .join("\n\n");
  if (markdown.length > 0) {
    return markdown;
  }
  return typeof fallbackContent === "string" ? fallbackContent.trim() : "";
};

const normalizePropertyNames = (values: string[]): string[] => {
  const normalized = values
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.replace(/\s+/g, " "));
  if (!normalized.some((entry) => entry.toLowerCase() === "name")) {
    normalized.unshift("Name");
  }
  return [...new Set(normalized)];
};

const toDatabaseProperties = (propertyNames: string[]): Record<string, unknown> => {
  const keys = normalizePropertyNames(propertyNames);
  const properties: Record<string, unknown> = {};
  for (const key of keys) {
    if (key.toLowerCase() === "name") {
      properties[key] = { title: {} };
    } else {
      properties[key] = { rich_text: {} };
    }
  }
  return properties;
};

const toNotionPageProperty = (
  value: unknown,
  pageId: string,
  propertyId: string,
): NotionPageProperty | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const entry = value as Record<string, unknown>;
  if (entry.object === "list" && Array.isArray(entry.results)) {
    return {
      pageId,
      propertyId,
      type: "list",
      value: entry.results,
    };
  }

  const type = typeof entry.type === "string" ? entry.type : "unknown";
  const valueField = entry[type] ?? entry.value ?? null;
  return {
    pageId,
    propertyId,
    type,
    value: valueField,
  };
};

const toNotionUser = (value: unknown): NotionUser | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const id = String(entry.id ?? "").trim();
  const type = String(entry.type ?? "").trim();
  if (!id || !type) {
    return null;
  }

  const person = asRecord(entry.person);
  const bot = asRecord(entry.bot);
  const botOwner = asRecord(bot.owner);
  const name =
    typeof entry.name === "string" && entry.name.trim().length > 0
      ? entry.name.trim()
      : type === "bot"
        ? "Notion Bot"
        : "Unknown User";

  return {
    id,
    type,
    name,
    ...(typeof entry.avatar_url === "string" ? { avatarUrl: entry.avatar_url } : {}),
    ...(typeof person.email === "string"
      ? { email: person.email }
      : typeof botOwner.type === "string"
        ? { email: `bot:${String(botOwner.type)}` }
        : {}),
  };
};

export class NotionSdk extends BaseSdkPort<CreateNotionClient> implements NotionSdkPort {
  constructor(options: {
    createClient: CreateNotionClient;
    runtime?: ProviderSdkRuntime;
    callLog?: ProviderSdkCallLog;
  }) {
    super({
      providerId: "notion",
      createClient: options.createClient,
      ...(options.runtime ? { runtime: options.runtime } : {}),
      ...(options.callLog ? { callLog: options.callLog } : {}),
    });
  }

  async searchPages(args: NotionSearchPagesArgs): Promise<NotionPage[]> {
    const method = "notion.search";
    const normalizedArgs = {
      namespace: args.namespace,
      query: args.query,
      pageSize: args.pageSize,
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.search_pages",
      });
      const response = await notion.search({
        query: args.query,
        page_size: Math.max(1, Math.min(100, Number(args.pageSize) || 20)),
        filter: {
          property: "object",
          value: "page",
        },
      });

      const pages = response.results
        .map((entry) => toNotionPage(entry))
        .filter((entry): entry is NotionPage => !!entry);

      this.captureOk(args.namespace, method, normalizedArgs, pages);
      return pages;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getPage(args: NotionGetPageArgs): Promise<NotionPage> {
    const method = "notion.pages.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      pageId: args.pageId,
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.get_page",
      });
      const page = await notion.pages.retrieve({
        page_id: args.pageId,
      });
      const normalizedPage = toNotionPage(page);
      if (!normalizedPage) {
        throw new Error("invalid_provider_response");
      }

      this.captureOk(args.namespace, method, normalizedArgs, normalizedPage);
      return normalizedPage;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getPageAsMarkdown(args: NotionGetPageAsMarkdownArgs): Promise<NotionPageMarkdown> {
    const method = "notion.pages.markdown.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      pageId: args.pageId,
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.get_page_markdown",
      });
      const pageResponse = await notion.pages.retrieve({
        page_id: args.pageId,
      });
      const page = toNotionPage(pageResponse);
      if (!page) {
        throw new Error("invalid_provider_response");
      }

      const children = await notion.blocks.children.list({
        block_id: args.pageId,
        page_size: 100,
      });
      const blocks = children.results
        .map((entry) => toNotionBlock(entry))
        .filter((entry): entry is NotionBlock => !!entry);

      const response: NotionPageMarkdown = {
        pageId: page.id,
        title: page.title,
        markdown: toMarkdownFromBlocks(blocks, page.content),
        blockCount: blocks.length,
      };

      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async queryDatabase(args: NotionQueryDatabaseArgs): Promise<NotionPage[]> {
    const method = "notion.databases.query";
    const normalizedArgs = {
      namespace: args.namespace,
      databaseId: args.databaseId,
      query: args.query,
      pageSize: args.pageSize,
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.query_database",
      });
      const response = await notion.databases.query({
        database_id: args.databaseId,
        page_size: Math.max(1, Math.min(100, Number(args.pageSize) || 20)),
        ...(args.query.trim().length > 0 ? { query: args.query } : {}),
      });
      const results = Array.isArray(response.results) ? response.results : [];
      const pages = results
        .map((entry: unknown) => toNotionPage(entry))
        .filter((entry): entry is NotionPage => !!entry);

      this.captureOk(args.namespace, method, normalizedArgs, pages);
      return pages;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getDatabase(args: NotionGetDatabaseArgs): Promise<NotionDatabase> {
    const method = "notion.databases.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      databaseId: args.databaseId,
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.get_database",
      });
      const response = await notion.databases.retrieve({
        database_id: args.databaseId,
      });
      const database = toNotionDatabase(response);
      if (!database) {
        throw new Error("invalid_provider_response");
      }

      this.captureOk(args.namespace, method, normalizedArgs, database);
      return database;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getBlockChildren(args: NotionGetBlockChildrenArgs): Promise<NotionBlock[]> {
    const method = "notion.blocks.children.list";
    const normalizedArgs = {
      namespace: args.namespace,
      blockId: args.blockId,
      pageSize: args.pageSize,
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.get_block_children",
      });
      const response = await notion.blocks.children.list({
        block_id: args.blockId,
        page_size: Math.max(1, Math.min(100, Number(args.pageSize) || 20)),
      });
      const blocks = response.results
        .map((entry) => toNotionBlock(entry))
        .filter((entry): entry is NotionBlock => !!entry);

      this.captureOk(args.namespace, method, normalizedArgs, blocks);
      return blocks;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getBlock(args: NotionGetBlockArgs): Promise<NotionBlock> {
    const method = "notion.blocks.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      blockId: args.blockId,
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.get_block",
      });
      const response = await notion.blocks.retrieve({
        block_id: args.blockId,
      });
      const block = toNotionBlock(response);
      if (!block) {
        throw new Error("invalid_provider_response");
      }

      this.captureOk(args.namespace, method, normalizedArgs, block);
      return block;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listComments(args: NotionListCommentsArgs): Promise<NotionComment[]> {
    const method = "notion.comments.list";
    const normalizedArgs = {
      namespace: args.namespace,
      pageId: args.pageId,
      pageSize: args.pageSize,
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.list_comments",
      });
      const response = await notion.comments.list({
        block_id: args.pageId,
        page_size: Math.max(1, Math.min(100, Number(args.pageSize) || 20)),
      });
      const comments = response.results
        .map((entry) => toNotionComment(entry, args.pageId))
        .filter((entry): entry is NotionComment => !!entry);

      this.captureOk(args.namespace, method, normalizedArgs, comments);
      return comments;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getComment(args: NotionGetCommentArgs): Promise<NotionComment> {
    const method = "notion.comments.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      commentId: args.commentId,
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.get_comment",
      });
      const response = await notion.comments.retrieve({
        comment_id: args.commentId,
      });
      const comment = toNotionComment(response);
      if (!comment) {
        throw new Error("invalid_provider_response");
      }

      this.captureOk(args.namespace, method, normalizedArgs, comment);
      return comment;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getPageProperty(args: NotionGetPagePropertyArgs): Promise<NotionPageProperty> {
    const method = "notion.pages.properties.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      pageId: args.pageId,
      propertyId: args.propertyId,
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.get_page_property",
      });
      const response = await notion.pages.properties.retrieve({
        page_id: args.pageId,
        property_id: args.propertyId,
      });
      const property = toNotionPageProperty(response, args.pageId, args.propertyId);
      if (!property) {
        throw new Error("invalid_provider_response");
      }

      this.captureOk(args.namespace, method, normalizedArgs, property);
      return property;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listUsers(args: NotionListUsersArgs): Promise<NotionUser[]> {
    const method = "notion.users.list";
    const normalizedArgs = {
      namespace: args.namespace,
      pageSize: args.pageSize,
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.list_users",
      });
      const response = await notion.users.list({
        page_size: Math.max(1, Math.min(100, Number(args.pageSize) || 20)),
      });
      const users = response.results
        .map((entry) => toNotionUser(entry))
        .filter((entry): entry is NotionUser => !!entry);

      this.captureOk(args.namespace, method, normalizedArgs, users);
      return users;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getUser(args: NotionGetUserArgs): Promise<NotionUser> {
    const method = "notion.users.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      userId: args.userId,
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.get_user",
      });
      const response = await notion.users.retrieve({
        user_id: args.userId,
      });
      const user = toNotionUser(response);
      if (!user) {
        throw new Error("invalid_provider_response");
      }

      this.captureOk(args.namespace, method, normalizedArgs, user);
      return user;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getBotUser(args: {
    accessToken: string;
    namespace?: string | undefined;
  }): Promise<NotionUser> {
    const method = "notion.users.me";
    const normalizedArgs = {
      namespace: args.namespace,
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.get_bot_user",
      });
      const response = await notion.users.me();
      const user = toNotionUser(response);
      if (!user) {
        throw new Error("invalid_provider_response");
      }

      this.captureOk(args.namespace, method, normalizedArgs, user);
      return user;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async createPage(args: NotionCreatePageArgs): Promise<NotionCreatePageResponse> {
    const method = "notion.pages.create";
    const normalizedArgs = {
      namespace: args.namespace,
      title: args.title,
      content: args.content,
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.create_page",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const created = await notion.pages.create({
        parent: {
          type: "workspace",
          workspace: true,
        },
        properties: {
          title: {
            title: [
              {
                type: "text",
                text: {
                  content: args.title,
                },
              },
            ],
          },
        },
        ...(args.content.trim().length > 0
          ? {
              children: createParagraphChildren(args.content),
            }
          : {}),
      });
      const createdRecord =
        created && typeof created === "object" && !Array.isArray(created)
          ? (created as Record<string, unknown>)
          : {};
      const createdId = String(createdRecord.id ?? "").trim();
      if (!createdId) {
        throw new Error("invalid_provider_response");
      }
      const createdEntry = created as Parameters<typeof isFullPage>[0];

      const normalizedResponse: NotionCreatePageResponse = {
        id: createdId,
        title: isFullPage(createdEntry) ? readNotionTitle(createdEntry) : args.title,
        content: args.content,
        ...(isFullPage(createdEntry) && createdEntry.url
          ? { url: createdEntry.url }
          : typeof createdRecord.url === "string"
            ? { url: createdRecord.url }
            : {}),
      };

      this.captureOk(
        args.namespace,
        method,
        normalizedArgs,
        normalizedResponse,
        args.idempotencyKey,
      );
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async movePage(args: NotionMovePageArgs): Promise<NotionPage> {
    const method = "notion.pages.move";
    const normalizedArgs = {
      namespace: args.namespace,
      pageId: args.pageId,
      parentPageId: args.parentPageId,
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.move_page",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await notion.pages.move({
        page_id: args.pageId,
        parent_page_id: args.parentPageId,
      });
      const page = toNotionPage(response);
      if (!page) {
        throw new Error("invalid_provider_response");
      }

      const moved: NotionPage = {
        ...page,
        parentPageId: args.parentPageId,
      };
      this.captureOk(args.namespace, method, normalizedArgs, moved, args.idempotencyKey);
      return moved;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async createDatabase(args: NotionCreateDatabaseArgs): Promise<NotionDatabase> {
    const method = "notion.databases.create";
    const normalizedArgs = {
      namespace: args.namespace,
      title: args.title,
      propertyNames: normalizePropertyNames(args.propertyNames),
      ...(args.parentPageId ? { parentPageId: args.parentPageId } : {}),
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.create_database",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const properties = toDatabaseProperties(args.propertyNames);
      const created = await notion.databases.create({
        parent: args.parentPageId
          ? {
              type: "page_id",
              page_id: args.parentPageId,
            }
          : {
              type: "workspace",
              workspace: true,
            },
        title: [
          {
            type: "text",
            text: {
              content: args.title,
            },
          },
        ],
        properties,
      });
      const database = toNotionDatabase(created);
      if (!database) {
        throw new Error("invalid_provider_response");
      }

      this.captureOk(args.namespace, method, normalizedArgs, database, args.idempotencyKey);
      return database;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async updatePage(args: NotionUpdatePageArgs): Promise<NotionPage> {
    const method = "notion.pages.update";
    const normalizedArgs = {
      namespace: args.namespace,
      pageId: args.pageId,
      ...(typeof args.title === "string" ? { title: args.title } : {}),
      ...(typeof args.archived === "boolean" ? { archived: args.archived } : {}),
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.update_page",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const updatePayload: Record<string, unknown> = {
        page_id: args.pageId,
      };
      if (typeof args.title === "string") {
        updatePayload.properties = {
          title: {
            title: [
              {
                type: "text",
                text: {
                  content: args.title,
                },
              },
            ],
          },
        };
      }
      if (typeof args.archived === "boolean") {
        updatePayload.archived = args.archived;
      }

      const updated = await notion.pages.update(updatePayload);
      const normalizedPage = toNotionPage(updated);
      if (!normalizedPage) {
        throw new Error("invalid_provider_response");
      }

      this.captureOk(args.namespace, method, normalizedArgs, normalizedPage, args.idempotencyKey);
      return normalizedPage;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async updatePageMarkdown(
    args: NotionUpdatePageMarkdownArgs,
  ): Promise<NotionUpdatePageMarkdownResponse> {
    const method = "notion.pages.markdown.update";
    const normalizedArgs = {
      namespace: args.namespace,
      pageId: args.pageId,
      markdown: args.markdown,
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.update_page_markdown",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const children = await notion.blocks.children.list({
        block_id: args.pageId,
        page_size: 100,
      });
      const firstBlock = children.results
        .map((entry) => toNotionBlock(entry))
        .find((entry): entry is NotionBlock => !!entry);

      const markdown = args.markdown.trim();
      let updatedBlockId = firstBlock?.id;
      if (firstBlock?.id) {
        const updated = await notion.blocks.update({
          block_id: firstBlock.id,
          type: "paragraph",
          paragraph: {
            rich_text: buildNotionRichText(markdown),
          },
        });
        const normalizedUpdated = toNotionBlock(updated);
        updatedBlockId = normalizedUpdated?.id ?? firstBlock.id;
      } else {
        const appended = await notion.blocks.children.append({
          block_id: args.pageId,
          children: createParagraphChildren(markdown),
        });
        const appendedBlock = appended.results
          .map((entry) => toNotionBlock(entry))
          .find((entry): entry is NotionBlock => !!entry);
        updatedBlockId = appendedBlock?.id;
      }

      if (!updatedBlockId) {
        throw new Error("invalid_provider_response");
      }
      const response: NotionUpdatePageMarkdownResponse = {
        pageId: args.pageId,
        markdown,
        updatedBlockId,
      };
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async updateDatabase(args: NotionUpdateDatabaseArgs): Promise<NotionDatabase> {
    const method = "notion.databases.update";
    const normalizedArgs = {
      namespace: args.namespace,
      databaseId: args.databaseId,
      ...(typeof args.title === "string" ? { title: args.title } : {}),
      ...(Array.isArray(args.propertyNames)
        ? { propertyNames: normalizePropertyNames(args.propertyNames) }
        : {}),
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.update_database",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const updatePayload: Record<string, unknown> = {
        database_id: args.databaseId,
      };
      if (typeof args.title === "string") {
        updatePayload.title = [
          {
            type: "text",
            text: {
              content: args.title,
            },
          },
        ];
      }
      if (Array.isArray(args.propertyNames)) {
        updatePayload.properties = toDatabaseProperties(args.propertyNames);
      }
      const updated = await notion.databases.update(updatePayload);
      const database = toNotionDatabase(updated);
      if (!database) {
        throw new Error("invalid_provider_response");
      }

      this.captureOk(args.namespace, method, normalizedArgs, database, args.idempotencyKey);
      return database;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async appendBlockChildren(args: NotionAppendBlockChildrenArgs): Promise<NotionBlock[]> {
    const method = "notion.blocks.children.append";
    const normalizedArgs = {
      namespace: args.namespace,
      blockId: args.blockId,
      content: args.content,
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.append_block_children",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await notion.blocks.children.append({
        block_id: args.blockId,
        children: createParagraphChildren(args.content),
      });
      const blocks = response.results
        .map((entry) => toNotionBlock(entry))
        .filter((entry): entry is NotionBlock => !!entry);

      this.captureOk(args.namespace, method, normalizedArgs, blocks, args.idempotencyKey);
      return blocks;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async updateBlock(args: NotionUpdateBlockArgs): Promise<NotionBlock> {
    const method = "notion.blocks.update";
    const normalizedArgs = {
      namespace: args.namespace,
      blockId: args.blockId,
      content: args.content,
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.update_block",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await notion.blocks.update({
        block_id: args.blockId,
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: {
                content: args.content,
              },
            },
          ],
        },
      });
      const block =
        toNotionBlock(response) ??
        ({
          id: args.blockId,
          type: "paragraph",
          text: args.content,
          hasChildren: false,
        } satisfies NotionBlock);

      this.captureOk(args.namespace, method, normalizedArgs, block, args.idempotencyKey);
      return block;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async deleteBlock(args: NotionDeleteBlockArgs): Promise<NotionBlock> {
    const method = "notion.blocks.delete";
    const normalizedArgs = {
      namespace: args.namespace,
      blockId: args.blockId,
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.delete_block",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await notion.blocks.delete({
        block_id: args.blockId,
      });
      const block =
        toNotionBlock(response) ??
        ({
          id: args.blockId,
          type: "paragraph",
          hasChildren: false,
          archived: true,
        } satisfies NotionBlock);
      const archivedBlock: NotionBlock = {
        ...block,
        archived: true,
      };

      this.captureOk(args.namespace, method, normalizedArgs, archivedBlock, args.idempotencyKey);
      return archivedBlock;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async createComment(args: NotionCreateCommentArgs): Promise<NotionComment> {
    const method = "notion.comments.create";
    const normalizedArgs = {
      namespace: args.namespace,
      pageId: args.pageId,
      content: args.content,
    };

    try {
      const notion = this.createClient(args.accessToken, args.namespace, {
        requestContext: "notion.sdk.create_comment",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await notion.comments.create({
        parent: {
          page_id: args.pageId,
        },
        rich_text: [
          {
            type: "text",
            text: {
              content: args.content,
            },
          },
        ],
      });
      const comment = toNotionComment(response, args.pageId);
      if (!comment) {
        throw new Error("invalid_provider_response");
      }

      this.captureOk(args.namespace, method, normalizedArgs, comment, args.idempotencyKey);
      return comment;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }
}

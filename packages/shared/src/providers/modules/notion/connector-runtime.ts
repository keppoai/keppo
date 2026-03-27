import { buildProviderIdempotencyKey } from "../../../provider-write-utils.js";
import { notionTools } from "../../../tool-definitions.js";
import { BaseConnector } from "../../../connectors/base-connector.js";
import type { Connector, ConnectorContext, PreparedWrite } from "../../../connectors/base.js";
import { createRealNotionSdk } from "../../../provider-sdk/notion/real.js";
import type { NotionSdkPort } from "../../../provider-sdk/notion/types.js";
import {
  createProviderCircuitBreaker,
  wrapObjectWithCircuitBreaker,
} from "../../../circuit-breaker.js";

const requiredScopesByTool: Record<string, string[]> = {
  "notion.searchPages": ["notion.read"],
  "notion.getPage": ["notion.read"],
  "notion.getPageAsMarkdown": ["notion.read"],
  "notion.queryDatabase": ["notion.read"],
  "notion.getDatabase": ["notion.read"],
  "notion.getBlockChildren": ["notion.read"],
  "notion.getBlock": ["notion.read"],
  "notion.listComments": ["notion.read"],
  "notion.getComment": ["notion.read"],
  "notion.getPageProperty": ["notion.read"],
  "notion.listUsers": ["notion.read"],
  "notion.getUser": ["notion.read"],
  "notion.getBotUser": ["notion.read"],
  "notion.createPage": ["notion.write"],
  "notion.createDatabase": ["notion.write"],
  "notion.updatePage": ["notion.write"],
  "notion.movePage": ["notion.write"],
  "notion.updatePageMarkdown": ["notion.write"],
  "notion.updateDatabase": ["notion.write"],
  "notion.appendBlockChildren": ["notion.write"],
  "notion.updateBlock": ["notion.write"],
  "notion.deleteBlock": ["notion.write"],
  "notion.createComment": ["notion.write"],
};

const FAKE_NOTION_ACCESS_TOKEN = process.env.KEPPO_FAKE_NOTION_ACCESS_TOKEN?.trim();

const getToken = (context: ConnectorContext): string => {
  if (context.access_token) {
    return context.access_token;
  }
  if (FAKE_NOTION_ACCESS_TOKEN) {
    return FAKE_NOTION_ACCESS_TOKEN;
  }
  throw new Error("Notion access token missing. Reconnect Notion integration.");
};

const providerCircuitBreaker = createProviderCircuitBreaker("notion");

type NotionReadToolName =
  | "notion.searchPages"
  | "notion.getPage"
  | "notion.getPageAsMarkdown"
  | "notion.queryDatabase"
  | "notion.getDatabase"
  | "notion.getBlockChildren"
  | "notion.getBlock"
  | "notion.listComments"
  | "notion.getComment"
  | "notion.getPageProperty"
  | "notion.listUsers"
  | "notion.getUser"
  | "notion.getBotUser";

type NotionWriteToolName =
  | "notion.createPage"
  | "notion.createDatabase"
  | "notion.updatePage"
  | "notion.movePage"
  | "notion.updatePageMarkdown"
  | "notion.updateDatabase"
  | "notion.appendBlockChildren"
  | "notion.updateBlock"
  | "notion.deleteBlock"
  | "notion.createComment";

type NotionReadDispatchInput = {
  validated: Record<string, unknown>;
  accessToken: string;
  namespace: string | undefined;
};

type NotionPrepareDispatchInput = {
  validated: Record<string, unknown>;
};

type NotionWriteDispatchInput = {
  normalizedPayload: Record<string, unknown>;
  accessToken: string;
  namespace: string | undefined;
};

export const createNotionConnector = (options?: { sdk?: NotionSdkPort }): Connector => {
  const sdk = wrapObjectWithCircuitBreaker(
    options?.sdk ?? createRealNotionSdk(),
    providerCircuitBreaker,
  );

  const readMap: Record<
    NotionReadToolName,
    (payload: NotionReadDispatchInput) => Promise<Record<string, unknown>>
  > = {
    "notion.searchPages": async ({ validated, accessToken, namespace }) => {
      const query = String(validated.query ?? "");
      const pages = await sdk.searchPages({
        accessToken,
        namespace,
        query,
        pageSize: 20,
      });

      return {
        query,
        pages: pages.map((page) => ({
          id: page.id,
          title: page.title,
          ...(page.url ? { url: page.url } : {}),
        })),
      };
    },
    "notion.getPage": async ({ validated, accessToken, namespace }) => {
      const page = await sdk.getPage({
        accessToken,
        namespace,
        pageId: String(validated.pageId ?? ""),
      });

      return {
        pageId: page.id,
        title: page.title,
        archived: page.archived,
        ...(page.url ? { url: page.url } : {}),
        ...(page.properties ? { properties: page.properties } : {}),
      };
    },
    "notion.getPageAsMarkdown": async ({ validated, accessToken, namespace }) => {
      const markdown = await sdk.getPageAsMarkdown({
        accessToken,
        namespace,
        pageId: String(validated.pageId ?? ""),
      });
      return {
        pageId: markdown.pageId,
        title: markdown.title,
        markdown: markdown.markdown,
        blockCount: markdown.blockCount,
      };
    },
    "notion.queryDatabase": async ({ validated, accessToken, namespace }) => {
      const databaseId = String(validated.databaseId ?? "");
      const query = String(validated.query ?? "");
      const pageSize = Number(validated.pageSize ?? 20) || 20;
      const pages = await sdk.queryDatabase({
        accessToken,
        namespace,
        databaseId,
        query,
        pageSize,
      });
      return {
        databaseId,
        query,
        results: pages.map((page) => ({
          id: page.id,
          title: page.title,
          ...(page.url ? { url: page.url } : {}),
        })),
      };
    },
    "notion.getDatabase": async ({ validated, accessToken, namespace }) => {
      const database = await sdk.getDatabase({
        accessToken,
        namespace,
        databaseId: String(validated.databaseId ?? ""),
      });

      return {
        database: {
          id: database.id,
          title: database.title,
          propertyKeys: database.propertyKeys,
          ...(database.url ? { url: database.url } : {}),
        },
      };
    },
    "notion.getBlockChildren": async ({ validated, accessToken, namespace }) => {
      const blockId = String(validated.blockId ?? "");
      const pageSize = Number(validated.pageSize ?? 20) || 20;
      const children = await sdk.getBlockChildren({
        accessToken,
        namespace,
        blockId,
        pageSize,
      });
      return {
        blockId,
        children: children.map((child) => ({
          id: child.id,
          type: child.type,
          hasChildren: child.hasChildren,
          ...(child.text ? { text: child.text } : {}),
        })),
      };
    },
    "notion.getBlock": async ({ validated, accessToken, namespace }) => {
      const block = await sdk.getBlock({
        accessToken,
        namespace,
        blockId: String(validated.blockId ?? ""),
      });
      return {
        blockId: block.id,
        type: block.type,
        hasChildren: block.hasChildren,
        ...(block.text ? { text: block.text } : {}),
        ...(typeof block.archived === "boolean" ? { archived: block.archived } : {}),
      };
    },
    "notion.listComments": async ({ validated, accessToken, namespace }) => {
      const pageId = String(validated.pageId ?? "");
      const pageSize = Number(validated.pageSize ?? 20) || 20;
      const comments = await sdk.listComments({
        accessToken,
        namespace,
        pageId,
        pageSize,
      });
      return {
        pageId,
        comments: comments.map((comment) => ({
          id: comment.id,
          content: comment.content,
          ...(comment.createdBy ? { createdBy: comment.createdBy } : {}),
        })),
      };
    },
    "notion.getComment": async ({ validated, accessToken, namespace }) => {
      const comment = await sdk.getComment({
        accessToken,
        namespace,
        commentId: String(validated.commentId ?? ""),
      });
      return {
        comment: {
          id: comment.id,
          pageId: comment.pageId,
          content: comment.content,
          ...(comment.createdBy ? { createdBy: comment.createdBy } : {}),
        },
      };
    },
    "notion.getPageProperty": async ({ validated, accessToken, namespace }) => {
      const property = await sdk.getPageProperty({
        accessToken,
        namespace,
        pageId: String(validated.pageId ?? ""),
        propertyId: String(validated.propertyId ?? ""),
      });
      return {
        pageId: property.pageId,
        propertyId: property.propertyId,
        type: property.type,
        value: property.value,
      };
    },
    "notion.listUsers": async ({ validated, accessToken, namespace }) => {
      const pageSize = Number(validated.pageSize ?? 20) || 20;
      const users = await sdk.listUsers({
        accessToken,
        namespace,
        pageSize,
      });
      return {
        users: users.map((user) => ({
          id: user.id,
          type: user.type,
          name: user.name,
          ...(user.email ? { email: user.email } : {}),
          ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
        })),
      };
    },
    "notion.getUser": async ({ validated, accessToken, namespace }) => {
      const user = await sdk.getUser({
        accessToken,
        namespace,
        userId: String(validated.userId ?? ""),
      });
      return {
        user: {
          id: user.id,
          type: user.type,
          name: user.name,
          ...(user.email ? { email: user.email } : {}),
          ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
        },
      };
    },
    "notion.getBotUser": async ({ accessToken, namespace }) => {
      const user = await sdk.getBotUser({
        accessToken,
        namespace,
      });
      return {
        botUser: {
          id: user.id,
          type: user.type,
          name: user.name,
          ...(user.email ? { email: user.email } : {}),
          ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
        },
      };
    },
  };

  const prepareMap: Record<
    NotionWriteToolName,
    (payload: NotionPrepareDispatchInput) => Promise<PreparedWrite>
  > = {
    "notion.createPage": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "create_page",
          title: String(validated.title ?? ""),
          content: String(validated.content ?? ""),
        },
        payload_preview: {
          title: String(validated.title ?? ""),
          content_preview: String(validated.content ?? "").slice(0, 120),
        },
      };
    },
    "notion.createDatabase": async ({ validated }) => {
      const propertyNames = Array.isArray(validated.propertyNames)
        ? validated.propertyNames
            .map((entry) => String(entry).trim())
            .filter((entry) => entry.length > 0)
        : [];
      return {
        normalized_payload: {
          type: "create_database",
          title: String(validated.title ?? ""),
          propertyNames,
          ...(typeof validated.parentPageId === "string" && validated.parentPageId.length > 0
            ? { parentPageId: validated.parentPageId }
            : {}),
        },
        payload_preview: {
          title: String(validated.title ?? ""),
          propertyCount: propertyNames.length,
          ...(typeof validated.parentPageId === "string" && validated.parentPageId.length > 0
            ? { parentPageId: validated.parentPageId }
            : {}),
        },
      };
    },
    "notion.updatePage": async ({ validated }) => {
      const pageId = String(validated.pageId ?? "");
      const title =
        typeof validated.title === "string" && validated.title.trim().length > 0
          ? validated.title
          : undefined;
      const archived = typeof validated.archived === "boolean" ? validated.archived : undefined;
      return {
        normalized_payload: {
          type: "update_page",
          pageId,
          ...(title !== undefined ? { title } : {}),
          ...(archived !== undefined ? { archived } : {}),
        },
        payload_preview: {
          pageId,
          ...(title !== undefined ? { title } : {}),
          ...(archived !== undefined ? { archived } : {}),
        },
      };
    },
    "notion.movePage": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "move_page",
          pageId: String(validated.pageId ?? ""),
          parentPageId: String(validated.parentPageId ?? ""),
        },
        payload_preview: {
          pageId: String(validated.pageId ?? ""),
          parentPageId: String(validated.parentPageId ?? ""),
        },
      };
    },
    "notion.updatePageMarkdown": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "update_page_markdown",
          pageId: String(validated.pageId ?? ""),
          markdown: String(validated.markdown ?? ""),
        },
        payload_preview: {
          pageId: String(validated.pageId ?? ""),
          markdown_preview: String(validated.markdown ?? "").slice(0, 120),
        },
      };
    },
    "notion.updateDatabase": async ({ validated }) => {
      const propertyNames = Array.isArray(validated.propertyNames)
        ? validated.propertyNames
            .map((entry) => String(entry).trim())
            .filter((entry) => entry.length > 0)
        : undefined;
      return {
        normalized_payload: {
          type: "update_database",
          databaseId: String(validated.databaseId ?? ""),
          ...(typeof validated.title === "string" ? { title: validated.title } : {}),
          ...(propertyNames ? { propertyNames } : {}),
        },
        payload_preview: {
          databaseId: String(validated.databaseId ?? ""),
          ...(typeof validated.title === "string" ? { title: validated.title } : {}),
          ...(propertyNames ? { propertyCount: propertyNames.length } : {}),
        },
      };
    },
    "notion.appendBlockChildren": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "append_block_children",
          blockId: String(validated.blockId ?? ""),
          content: String(validated.content ?? ""),
        },
        payload_preview: {
          blockId: String(validated.blockId ?? ""),
          content_preview: String(validated.content ?? "").slice(0, 120),
        },
      };
    },
    "notion.updateBlock": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "update_block",
          blockId: String(validated.blockId ?? ""),
          content: String(validated.content ?? ""),
        },
        payload_preview: {
          blockId: String(validated.blockId ?? ""),
          content_preview: String(validated.content ?? "").slice(0, 120),
        },
      };
    },
    "notion.deleteBlock": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "delete_block",
          blockId: String(validated.blockId ?? ""),
        },
        payload_preview: {
          blockId: String(validated.blockId ?? ""),
        },
      };
    },
    "notion.createComment": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "create_comment",
          pageId: String(validated.pageId ?? ""),
          content: String(validated.content ?? ""),
        },
        payload_preview: {
          pageId: String(validated.pageId ?? ""),
          content_preview: String(validated.content ?? "").slice(0, 120),
        },
      };
    },
  };

  const writeMap: Record<
    NotionWriteToolName,
    (payload: NotionWriteDispatchInput) => Promise<Record<string, unknown>>
  > = {
    "notion.createPage": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("notion.createPage", normalizedPayload);
      const response = await sdk.createPage({
        accessToken,
        namespace,
        title: String(normalizedPayload.title ?? ""),
        content: String(normalizedPayload.content ?? ""),
        idempotencyKey,
      });

      return {
        status: "created",
        provider_action_id: response.id,
        title: response.title,
        ...(response.url ? { url: response.url } : {}),
      };
    },
    "notion.createDatabase": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey(
        "notion.createDatabase",
        normalizedPayload,
      );
      const response = await sdk.createDatabase({
        accessToken,
        namespace,
        title: String(normalizedPayload.title ?? ""),
        propertyNames: Array.isArray(normalizedPayload.propertyNames)
          ? normalizedPayload.propertyNames.map((entry) => String(entry))
          : [],
        ...(typeof normalizedPayload.parentPageId === "string"
          ? { parentPageId: normalizedPayload.parentPageId }
          : {}),
        idempotencyKey,
      });
      return {
        status: "created",
        provider_action_id: response.id,
        title: response.title,
        propertyKeys: response.propertyKeys,
      };
    },
    "notion.updatePage": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("notion.updatePage", normalizedPayload);
      const response = await sdk.updatePage({
        accessToken,
        namespace,
        pageId: String(normalizedPayload.pageId ?? ""),
        ...(typeof normalizedPayload.title === "string" ? { title: normalizedPayload.title } : {}),
        ...(typeof normalizedPayload.archived === "boolean"
          ? { archived: normalizedPayload.archived }
          : {}),
        idempotencyKey,
      });
      return {
        status: "updated",
        provider_action_id: response.id,
        title: response.title,
        archived: response.archived,
      };
    },
    "notion.movePage": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("notion.movePage", normalizedPayload);
      const response = await sdk.movePage({
        accessToken,
        namespace,
        pageId: String(normalizedPayload.pageId ?? ""),
        parentPageId: String(normalizedPayload.parentPageId ?? ""),
        idempotencyKey,
      });
      return {
        status: "moved",
        provider_action_id: response.id,
        pageId: response.id,
        parentPageId: response.parentPageId,
        title: response.title,
      };
    },
    "notion.updatePageMarkdown": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey(
        "notion.updatePageMarkdown",
        normalizedPayload,
      );
      const response = await sdk.updatePageMarkdown({
        accessToken,
        namespace,
        pageId: String(normalizedPayload.pageId ?? ""),
        markdown: String(normalizedPayload.markdown ?? ""),
        idempotencyKey,
      });
      return {
        status: "updated",
        provider_action_id: response.updatedBlockId,
        pageId: response.pageId,
        updatedBlockId: response.updatedBlockId,
      };
    },
    "notion.updateDatabase": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey(
        "notion.updateDatabase",
        normalizedPayload,
      );
      const response = await sdk.updateDatabase({
        accessToken,
        namespace,
        databaseId: String(normalizedPayload.databaseId ?? ""),
        ...(typeof normalizedPayload.title === "string" ? { title: normalizedPayload.title } : {}),
        ...(Array.isArray(normalizedPayload.propertyNames)
          ? {
              propertyNames: normalizedPayload.propertyNames.map((entry) => String(entry)),
            }
          : {}),
        idempotencyKey,
      });
      return {
        status: "updated",
        provider_action_id: response.id,
        title: response.title,
        propertyKeys: response.propertyKeys,
      };
    },
    "notion.appendBlockChildren": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey(
        "notion.appendBlockChildren",
        normalizedPayload,
      );
      const children = await sdk.appendBlockChildren({
        accessToken,
        namespace,
        blockId: String(normalizedPayload.blockId ?? ""),
        content: String(normalizedPayload.content ?? ""),
        idempotencyKey,
      });
      const firstId = children[0]?.id ?? String(normalizedPayload.blockId ?? "");
      return {
        status: "appended",
        provider_action_id: firstId,
        appendedCount: children.length,
      };
    },
    "notion.updateBlock": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("notion.updateBlock", normalizedPayload);
      const block = await sdk.updateBlock({
        accessToken,
        namespace,
        blockId: String(normalizedPayload.blockId ?? ""),
        content: String(normalizedPayload.content ?? ""),
        idempotencyKey,
      });
      return {
        status: "updated",
        provider_action_id: block.id,
        type: block.type,
        hasChildren: block.hasChildren,
      };
    },
    "notion.deleteBlock": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("notion.deleteBlock", normalizedPayload);
      const block = await sdk.deleteBlock({
        accessToken,
        namespace,
        blockId: String(normalizedPayload.blockId ?? ""),
        idempotencyKey,
      });
      return {
        status: "deleted",
        provider_action_id: block.id,
        archived: true,
      };
    },
    "notion.createComment": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("notion.createComment", normalizedPayload);
      const comment = await sdk.createComment({
        accessToken,
        namespace,
        pageId: String(normalizedPayload.pageId ?? ""),
        content: String(normalizedPayload.content ?? ""),
        idempotencyKey,
      });
      return {
        status: "created",
        provider_action_id: comment.id,
        pageId: comment.pageId,
      };
    },
  };

  class NotionConnector extends BaseConnector<
    NotionReadDispatchInput,
    NotionPrepareDispatchInput,
    NotionWriteDispatchInput,
    typeof notionTools
  > {
    constructor() {
      super({
        provider: "notion",
        tools: notionTools,
        requiredScopesByTool,
        readMap,
        prepareMap,
        writeMap,
      });
    }

    protected getToken(context: ConnectorContext): string {
      return getToken(context);
    }

    protected buildReadDispatchInput(
      _toolName: string,
      validated: Record<string, unknown>,
      _context: ConnectorContext,
      runtime: { accessToken: string; namespace: string | undefined },
    ): NotionReadDispatchInput {
      return {
        validated,
        accessToken: runtime.accessToken,
        namespace: runtime.namespace,
      };
    }

    protected buildPrepareDispatchInput(
      _toolName: string,
      validated: Record<string, unknown>,
      _context: ConnectorContext,
    ): NotionPrepareDispatchInput {
      return { validated };
    }

    protected buildWriteDispatchInput(
      _toolName: string,
      normalizedPayload: Record<string, unknown>,
      _context: ConnectorContext,
      runtime: { accessToken: string; namespace: string | undefined },
    ): NotionWriteDispatchInput {
      return {
        normalizedPayload,
        accessToken: runtime.accessToken,
        namespace: runtime.namespace,
      };
    }

    protected override unsupportedToolMessage(
      phase: "read" | "prepare" | "write",
      toolName: string,
    ): string {
      if (phase === "read") {
        return `Unsupported Notion read tool ${toolName}`;
      }
      return `Unsupported Notion write tool ${toolName}`;
    }
  }

  return new NotionConnector();
};

const connector = createNotionConnector();

export default connector;

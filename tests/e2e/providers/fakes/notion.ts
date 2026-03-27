import {
  createFakeNotionClientStore,
  createFakeNotionSdk,
  type FakeNotionClientStore,
} from "../../../../packages/shared/src/provider-sdk/notion/fake.js";
import { BaseProviderFake } from "../base-fake";
import type { ProviderReadRequest, ProviderWriteRequest } from "../contract/provider-contract";

const defaultFakeToken = (): string =>
  process.env.KEPPO_FAKE_NOTION_ACCESS_TOKEN ?? "fake_notion_access_token";

const parseBody = (input: unknown): Record<string, unknown> => {
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
      return Object.fromEntries(new URLSearchParams(input).entries());
    }
  }
  return {};
};

const toNotionBlockPayload = (block: {
  id: string;
  type: string;
  hasChildren: boolean;
  text?: string;
  archived?: boolean;
}): Record<string, unknown> => {
  return {
    id: block.id,
    object: "block",
    type: block.type,
    has_children: block.hasChildren,
    ...(typeof block.archived === "boolean" ? { archived: block.archived } : {}),
    ...(block.text
      ? {
          [block.type]: {
            rich_text: [
              {
                plain_text: block.text,
                text: {
                  content: block.text,
                },
              },
            ],
          },
        }
      : {}),
  };
};

const toNotionUserPayload = (user: {
  id: string;
  type: string;
  name: string;
  avatarUrl?: string;
  email?: string;
}): Record<string, unknown> => {
  return {
    object: "user",
    id: user.id,
    type: user.type,
    name: user.name,
    ...(user.avatarUrl ? { avatar_url: user.avatarUrl } : {}),
    ...(user.type === "person"
      ? { person: user.email ? { email: user.email } : {} }
      : { bot: { owner: { type: "workspace" } } }),
  };
};

export class NotionFake extends BaseProviderFake {
  private readonly clientStore: FakeNotionClientStore = createFakeNotionClientStore();
  private readonly sdk = createFakeNotionSdk({ clientStore: this.clientStore });

  override async listResources(request: ProviderReadRequest): Promise<Record<string, unknown>> {
    if (request.resource === "pages") {
      const pages = await this.sdk.searchPages({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        query: request.query.query ?? "",
        pageSize: Number(request.query.limit ?? "20") || 20,
      });
      return {
        results: pages.map((page) => ({
          id: page.id,
          title: page.title,
          archived: page.archived ?? false,
          ...(page.url ? { url: page.url } : {}),
          ...(page.properties ? { properties: page.properties } : {}),
        })),
      };
    }

    if (request.resource === "database.query") {
      const pages = await this.sdk.queryDatabase({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        databaseId: String(request.query.databaseId ?? ""),
        query: request.query.query ?? "",
        pageSize: Number(request.query.limit ?? "20") || 20,
      });
      return {
        results: pages.map((page) => ({
          id: page.id,
          title: page.title,
          archived: page.archived ?? false,
          ...(page.url ? { url: page.url } : {}),
          ...(page.properties ? { properties: page.properties } : {}),
        })),
      };
    }

    if (request.resource === "blocks/children") {
      const blocks = await this.sdk.getBlockChildren({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        blockId: String(request.query.blockId ?? ""),
        pageSize: Number(request.query.limit ?? "20") || 20,
      });
      return {
        results: blocks.map((block) => toNotionBlockPayload(block)),
      };
    }

    if (request.resource === "comments") {
      const comments = await this.sdk.listComments({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        pageId: String(request.query.pageId ?? ""),
        pageSize: Number(request.query.limit ?? "20") || 20,
      });
      return {
        results: comments.map((comment) => ({
          id: comment.id,
          parent: { page_id: comment.pageId },
          rich_text: [
            {
              plain_text: comment.content,
              text: {
                content: comment.content,
              },
            },
          ],
          ...(comment.createdBy
            ? {
                created_by: {
                  id: comment.createdBy,
                },
              }
            : {}),
        })),
      };
    }

    if (request.resource === "users") {
      const users = await this.sdk.listUsers({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        pageSize: Number(request.query.limit ?? "20") || 20,
      });
      return {
        object: "list",
        results: users.map((user) => toNotionUserPayload(user)),
      };
    }

    throw new Error(`unsupported_resource:${request.resource}`);
  }

  override async readResource(request: ProviderReadRequest): Promise<Record<string, unknown>> {
    const pagePropertyMatch = request.resource.match(/^pages\/([^/]+)\/properties\/(.+)$/);
    if (pagePropertyMatch) {
      const pageId = decodeURIComponent(pagePropertyMatch[1] ?? "");
      const propertyId = decodeURIComponent(pagePropertyMatch[2] ?? "");
      const property = await this.sdk.getPageProperty({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        pageId,
        propertyId,
      });
      return {
        object: "property_item",
        id: property.propertyId,
        type: property.type,
        [property.type]: property.value,
      };
    }

    if (request.resource.startsWith("pages/")) {
      const markdownMatch = request.resource.match(/^pages\/([^/]+)\/markdown$/);
      if (markdownMatch) {
        const pageId = decodeURIComponent(markdownMatch[1] ?? "");
        const markdown = await this.sdk.getPageAsMarkdown({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          pageId,
        });
        return {
          page_id: markdown.pageId,
          title: markdown.title,
          markdown: markdown.markdown,
          block_count: markdown.blockCount,
        };
      }

      const pageId = request.resource.replace("pages/", "");
      const page = await this.sdk.getPage({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        pageId,
      });
      return {
        id: page.id,
        object: "page",
        title: page.title,
        archived: page.archived ?? false,
        ...(page.url ? { url: page.url } : {}),
        ...(page.properties ? { properties: page.properties } : {}),
      };
    }

    if (request.resource.startsWith("databases/")) {
      const databaseId = request.resource.replace("databases/", "");
      const database = await this.sdk.getDatabase({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        databaseId,
      });
      return {
        id: database.id,
        object: "database",
        title: [
          {
            plain_text: database.title,
            text: {
              content: database.title,
            },
          },
        ],
        properties: Object.fromEntries(
          database.propertyKeys.map((key) => [
            key,
            {
              id: key.toLowerCase(),
              type: "rich_text",
              name: key,
              rich_text: {},
            },
          ]),
        ),
        ...(database.url ? { url: database.url } : {}),
      };
    }

    if (request.resource.startsWith("blocks/")) {
      const blockId = request.resource.replace("blocks/", "");
      const block = await this.sdk.getBlock({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        blockId,
      });
      return toNotionBlockPayload(block);
    }

    if (request.resource === "users/me") {
      const user = await this.sdk.getBotUser({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
      });
      return toNotionUserPayload(user);
    }

    if (request.resource.startsWith("comments/")) {
      const commentId = request.resource.replace("comments/", "");
      const comment = await this.sdk.getComment({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        commentId,
      });
      return {
        id: comment.id,
        object: "comment",
        parent: {
          page_id: comment.pageId,
        },
        rich_text: [
          {
            plain_text: comment.content,
            text: {
              content: comment.content,
            },
          },
        ],
        ...(comment.createdBy
          ? {
              created_by: {
                id: comment.createdBy,
              },
            }
          : {}),
      };
    }

    if (request.resource.startsWith("users/")) {
      const userId = request.resource.replace("users/", "");
      const user = await this.sdk.getUser({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        userId,
      });
      return toNotionUserPayload(user);
    }

    throw new Error(`unsupported_resource:${request.resource}`);
  }

  override async writeResource(request: ProviderWriteRequest): Promise<Record<string, unknown>> {
    const payload = parseBody(request.body);
    const idempotencyKey =
      request.headers.get("x-idempotency-key") ??
      request.headers.get("Idempotency-Key") ??
      undefined;

    if (request.resource === "pages") {
      return await this.sdk.createPage({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        title: String(payload.title ?? ""),
        content: String(payload.content ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "databases") {
      const database = await this.sdk.createDatabase({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        title: String(payload.title ?? ""),
        propertyNames: Array.isArray(payload.propertyNames)
          ? payload.propertyNames.map((entry) => String(entry))
          : [],
        ...(typeof payload.parentPageId === "string" ? { parentPageId: payload.parentPageId } : {}),
        idempotencyKey,
      });
      return {
        id: database.id,
        object: "database",
        title: [
          {
            plain_text: database.title,
            text: {
              content: database.title,
            },
          },
        ],
        properties: Object.fromEntries(
          database.propertyKeys.map((key) => [
            key,
            {
              id: key.toLowerCase(),
              type: key === "Name" ? "title" : "rich_text",
              name: key,
              ...(key === "Name" ? { title: {} } : { rich_text: {} }),
            },
          ]),
        ),
        ...(database.parentPageId ? { parent: { page_id: database.parentPageId } } : {}),
        ...(database.url ? { url: database.url } : {}),
      };
    }

    if (request.resource === "pages/update") {
      const pageId = String(payload.pageId ?? "");
      const parentPageId =
        typeof payload.parentPageId === "string" ? String(payload.parentPageId) : undefined;
      const hasTitle = typeof payload.title === "string";
      const hasArchived = typeof payload.archived === "boolean";

      let page = null as Awaited<ReturnType<typeof this.sdk.updatePage>> | null;
      if (parentPageId && parentPageId.length > 0) {
        page = await this.sdk.movePage({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          pageId,
          parentPageId,
          idempotencyKey,
        });
      }

      if (hasTitle || hasArchived) {
        page = await this.sdk.updatePage({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          pageId,
          ...(hasTitle ? { title: String(payload.title) } : {}),
          ...(hasArchived ? { archived: Boolean(payload.archived) } : {}),
          idempotencyKey,
        });
      }

      if (!page) {
        throw new Error("invalid_request");
      }
      return page;
    }

    if (request.resource === "pages/move") {
      const page = await this.sdk.movePage({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        pageId: String(payload.pageId ?? ""),
        parentPageId: String(payload.parentPageId ?? ""),
        idempotencyKey,
      });
      return {
        id: page.id,
        object: "page",
        title: page.title,
        archived: page.archived ?? false,
        ...(page.parentPageId ? { parent: { page_id: page.parentPageId } } : {}),
        ...(page.url ? { url: page.url } : {}),
        ...(page.properties ? { properties: page.properties } : {}),
      };
    }

    if (request.resource === "pages/markdown/update") {
      const response = await this.sdk.updatePageMarkdown({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        pageId: String(payload.pageId ?? ""),
        markdown: String(payload.markdown ?? ""),
        idempotencyKey,
      });
      return {
        page_id: response.pageId,
        markdown: response.markdown,
        updated_block_id: response.updatedBlockId,
      };
    }

    if (request.resource === "databases/update") {
      const database = await this.sdk.updateDatabase({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        databaseId: String(payload.databaseId ?? ""),
        ...(typeof payload.title === "string" ? { title: payload.title } : {}),
        ...(Array.isArray(payload.propertyNames)
          ? { propertyNames: payload.propertyNames.map((entry) => String(entry)) }
          : {}),
        idempotencyKey,
      });
      return {
        id: database.id,
        object: "database",
        title: [
          {
            plain_text: database.title,
            text: {
              content: database.title,
            },
          },
        ],
        properties: Object.fromEntries(
          database.propertyKeys.map((key) => [
            key,
            {
              id: key.toLowerCase(),
              type: key === "Name" ? "title" : "rich_text",
              name: key,
              ...(key === "Name" ? { title: {} } : { rich_text: {} }),
            },
          ]),
        ),
        ...(database.parentPageId ? { parent: { page_id: database.parentPageId } } : {}),
        ...(database.url ? { url: database.url } : {}),
      };
    }

    if (request.resource === "blocks/children/append") {
      const blocks = await this.sdk.appendBlockChildren({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        blockId: String(payload.blockId ?? ""),
        content: String(payload.content ?? ""),
        idempotencyKey,
      });
      return {
        object: "list",
        results: blocks.map((block) => toNotionBlockPayload(block)),
      };
    }

    if (request.resource === "blocks/update") {
      const block = await this.sdk.updateBlock({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        blockId: String(payload.blockId ?? ""),
        content: String(payload.content ?? ""),
        idempotencyKey,
      });
      return toNotionBlockPayload(block);
    }

    if (request.resource === "blocks/delete") {
      const block = await this.sdk.deleteBlock({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        blockId: String(payload.blockId ?? ""),
        idempotencyKey,
      });
      return toNotionBlockPayload(block);
    }

    if (request.resource === "comments") {
      const comment = await this.sdk.createComment({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        pageId: String(payload.pageId ?? ""),
        content: String(payload.content ?? ""),
        idempotencyKey,
      });
      return {
        id: comment.id,
        object: "comment",
        parent: {
          page_id: comment.pageId,
        },
        rich_text: [
          {
            plain_text: comment.content,
            text: {
              content: comment.content,
            },
          },
        ],
        ...(comment.createdBy
          ? {
              created_by: {
                id: comment.createdBy,
              },
            }
          : {}),
      };
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

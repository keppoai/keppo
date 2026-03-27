import { ProviderSdkError, type ProviderSdkCallLog } from "../port.js";
import { BaseFakeClient } from "../base-fake-client.js";
import { asRecord } from "../client-adapter-utils.js";
import {
  seedNotionBotUser,
  seedNotionBlocks,
  seedNotionComments,
  seedNotionDatabases,
  seedNotionPages,
  seedNotionUsers,
} from "./fixtures.js";
import { toProviderSdkError } from "./errors.js";
import type { CreateNotionClient, NotionClient, NotionClientOptions } from "./client-interface.js";
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
  NotionSearchPagesArgs,
  NotionUpdateBlockArgs,
  NotionUpdateDatabaseArgs,
  NotionUpdatePageMarkdownArgs,
  NotionUpdatePageMarkdownResponse,
  NotionMovePageArgs,
  NotionUpdatePageArgs,
  NotionUser,
} from "./types.js";

type NotionNamespaceState = {
  pages: NotionPage[];
  databases: NotionDatabase[];
  blocksByParent: Record<string, NotionBlock[]>;
  comments: NotionComment[];
  users: NotionUser[];
  botUser: NotionUser;
  pageCount: number;
  blockCount: number;
  databaseCount: number;
  commentCount: number;
  idempotentResponses: Map<string, unknown>;
  forceRateLimit: boolean;
  forceTimeout: boolean;
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

export class InMemoryNotionEngine extends BaseFakeClient<NotionNamespaceState> {
  constructor(options?: { callLog?: ProviderSdkCallLog }) {
    super({
      providerId: "notion",
      ...(options?.callLog ? { callLog: options.callLog } : {}),
    });
  }

  async searchPages(args: NotionSearchPagesArgs): Promise<NotionPage[]> {
    const method = "notion.search";
    const normalizedArgs = {
      namespace: args.namespace,
      query: args.query,
      pageSize: args.pageSize,
    };
    return this.runNotionOperation(args, method, normalizedArgs, (state) =>
      this.filterPages(state.pages, args.query, args.pageSize),
    );
  }

  async getPage(args: NotionGetPageArgs): Promise<NotionPage> {
    const method = "notion.pages.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      pageId: args.pageId,
    };

    return this.runNotionOperation(args, method, normalizedArgs, (state) =>
      this.getPageById(state, args.pageId),
    );
  }

  async getPageAsMarkdown(args: NotionGetPageAsMarkdownArgs): Promise<NotionPageMarkdown> {
    const method = "notion.pages.markdown.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      pageId: args.pageId,
    };

    return this.runNotionOperation(args, method, normalizedArgs, (state) => {
      const page = this.getPageById(state, args.pageId);
      const blocks = state.blocksByParent[args.pageId] ?? [];
      return {
        pageId: page.id,
        title: page.title,
        markdown: toMarkdownFromBlocks(blocks, page.content),
        blockCount: blocks.length,
      };
    });
  }

  async queryDatabase(args: NotionQueryDatabaseArgs): Promise<NotionPage[]> {
    const method = "notion.databases.query";
    const normalizedArgs = {
      namespace: args.namespace,
      databaseId: args.databaseId,
      query: args.query,
      pageSize: args.pageSize,
    };

    return this.runNotionOperation(args, method, normalizedArgs, (state) => {
      this.getDatabaseById(state, args.databaseId);
      return this.filterPages(state.pages, args.query, args.pageSize);
    });
  }

  async getDatabase(args: NotionGetDatabaseArgs): Promise<NotionDatabase> {
    const method = "notion.databases.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      databaseId: args.databaseId,
    };

    return this.runNotionOperation(args, method, normalizedArgs, (state) =>
      this.getDatabaseById(state, args.databaseId),
    );
  }

  async getBlockChildren(args: NotionGetBlockChildrenArgs): Promise<NotionBlock[]> {
    const method = "notion.blocks.children.list";
    const normalizedArgs = {
      namespace: args.namespace,
      blockId: args.blockId,
      pageSize: args.pageSize,
    };

    return this.runNotionOperation(args, method, normalizedArgs, (state) => {
      this.assertBlockParentExists(state, args.blockId);
      const pageSize = Math.max(1, Math.min(100, Number(args.pageSize) || 20));
      return (state.blocksByParent[args.blockId] ?? []).slice(0, pageSize);
    });
  }

  async getBlock(args: NotionGetBlockArgs): Promise<NotionBlock> {
    const method = "notion.blocks.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      blockId: args.blockId,
    };

    return this.runNotionOperation(args, method, normalizedArgs, (state) =>
      this.getBlockById(state, args.blockId),
    );
  }

  async listComments(args: NotionListCommentsArgs): Promise<NotionComment[]> {
    const method = "notion.comments.list";
    const normalizedArgs = {
      namespace: args.namespace,
      pageId: args.pageId,
      pageSize: args.pageSize,
    };

    return this.runNotionOperation(args, method, normalizedArgs, (state) => {
      this.getPageById(state, args.pageId);
      const pageSize = Math.max(1, Math.min(100, Number(args.pageSize) || 20));
      return state.comments.filter((comment) => comment.pageId === args.pageId).slice(0, pageSize);
    });
  }

  async getComment(args: NotionGetCommentArgs): Promise<NotionComment> {
    const method = "notion.comments.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      commentId: args.commentId,
    };

    return this.runNotionOperation(args, method, normalizedArgs, (state) => {
      const comment = state.comments.find((entry) => entry.id === args.commentId);
      if (!comment) {
        throw new Error("comment_not_found");
      }
      return comment;
    });
  }

  async getPageProperty(args: NotionGetPagePropertyArgs): Promise<NotionPageProperty> {
    const method = "notion.pages.properties.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      pageId: args.pageId,
      propertyId: args.propertyId,
    };

    return this.runNotionOperation(args, method, normalizedArgs, (state) => {
      const page = this.getPageById(state, args.pageId);
      const properties = asRecord(page.properties);
      const raw = properties[args.propertyId];
      if (!raw) {
        throw new Error("property_not_found");
      }
      const record = asRecord(raw);
      return {
        pageId: args.pageId,
        propertyId: args.propertyId,
        type: typeof record.type === "string" ? record.type : "unknown",
        value: record.value ?? raw,
      };
    });
  }

  async listUsers(args: NotionListUsersArgs): Promise<NotionUser[]> {
    const method = "notion.users.list";
    const normalizedArgs = {
      namespace: args.namespace,
      pageSize: args.pageSize,
    };

    return this.runNotionOperation(args, method, normalizedArgs, (state) => {
      const pageSize = Math.max(1, Math.min(100, Number(args.pageSize) || 20));
      return state.users.slice(0, pageSize);
    });
  }

  async getUser(args: NotionGetUserArgs): Promise<NotionUser> {
    const method = "notion.users.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      userId: args.userId,
    };

    return this.runNotionOperation(args, method, normalizedArgs, (state) => {
      const user = state.users.find((entry) => entry.id === args.userId);
      if (!user) {
        throw new Error("user_not_found");
      }
      return user;
    });
  }

  async getBotUser(args: {
    accessToken: string;
    namespace?: string | undefined;
  }): Promise<NotionUser> {
    const method = "notion.users.me";
    const normalizedArgs = {
      namespace: args.namespace,
    };

    return this.runNotionOperation(args, method, normalizedArgs, (state) => state.botUser);
  }

  async createPage(args: NotionCreatePageArgs): Promise<NotionCreatePageResponse> {
    const method = "notion.pages.create";
    const normalizedArgs = {
      namespace: args.namespace,
      title: args.title,
      content: args.content,
    };

    return this.runNotionCachedOperation(args, method, normalizedArgs, (state) => {
      state.pageCount += 1;
      const response: NotionCreatePageResponse = {
        id: `page_${200 + state.pageCount}`,
        title: args.title,
        content: args.content,
        url: `https://example.notion.so/page_${200 + state.pageCount}`,
      };

      state.pages.unshift({
        id: response.id,
        title: response.title,
        content: response.content,
        properties: {
          title: {
            id: "title",
            type: "title",
            value: response.title,
          },
        },
        ...(response.url ? { url: response.url } : {}),
      });
      state.blocksByParent[response.id] = [
        {
          id: `blk_${200 + state.pageCount}_1`,
          type: "paragraph",
          text: args.content,
          hasChildren: false,
        },
      ];
      return response;
    });
  }

  async movePage(args: NotionMovePageArgs): Promise<NotionPage> {
    const method = "notion.pages.move";
    const normalizedArgs = {
      namespace: args.namespace,
      pageId: args.pageId,
      parentPageId: args.parentPageId,
    };

    return this.runNotionCachedOperation(args, method, normalizedArgs, (state) => {
      this.getPageById(state, args.parentPageId);
      const page = this.getPageById(state, args.pageId);
      const moved: NotionPage = {
        ...page,
        parentPageId: args.parentPageId,
      };
      state.pages = state.pages.map((entry) => (entry.id === page.id ? moved : entry));
      return moved;
    });
  }

  async createDatabase(args: NotionCreateDatabaseArgs): Promise<NotionDatabase> {
    const method = "notion.databases.create";
    const normalizedArgs = {
      namespace: args.namespace,
      title: args.title,
      propertyNames: normalizePropertyNames(args.propertyNames),
      ...(args.parentPageId ? { parentPageId: args.parentPageId } : {}),
    };

    return this.runNotionCachedOperation(args, method, normalizedArgs, (state) => {
      if (args.parentPageId) {
        this.getPageById(state, args.parentPageId);
      }
      state.databaseCount += 1;
      const response: NotionDatabase = {
        id: `db_${200 + state.databaseCount}`,
        title: args.title,
        propertyKeys: normalizePropertyNames(args.propertyNames),
        ...(args.parentPageId ? { parentPageId: args.parentPageId } : {}),
        url: `https://example.notion.so/db_${200 + state.databaseCount}`,
      };
      state.databases.unshift(response);
      return response;
    });
  }

  async updatePage(args: NotionUpdatePageArgs): Promise<NotionPage> {
    const method = "notion.pages.update";
    const normalizedArgs = {
      namespace: args.namespace,
      pageId: args.pageId,
      ...(typeof args.title === "string" ? { title: args.title } : {}),
      ...(typeof args.archived === "boolean" ? { archived: args.archived } : {}),
    };

    return this.runNotionCachedOperation(args, method, normalizedArgs, (state) => {
      const page = this.getPageById(state, args.pageId);
      const properties = asRecord(page.properties);
      const nextProperties =
        typeof args.title === "string"
          ? {
              ...properties,
              title: {
                id: "title",
                type: "title",
                value: args.title,
              },
            }
          : properties;
      const next: NotionPage = {
        ...page,
        ...(typeof args.title === "string" ? { title: args.title } : {}),
        ...(typeof args.archived === "boolean" ? { archived: args.archived } : {}),
        ...(Object.keys(nextProperties).length > 0 ? { properties: nextProperties } : {}),
      };
      state.pages = state.pages.map((entry) => (entry.id === page.id ? next : entry));
      return next;
    });
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

    return this.runNotionCachedOperation(args, method, normalizedArgs, (state) => {
      this.getPageById(state, args.pageId);
      const markdown = args.markdown.trim();
      const blocks = state.blocksByParent[args.pageId] ?? [];
      let updatedBlockId = blocks[0]?.id;
      if (blocks[0]) {
        const nextFirst: NotionBlock = {
          ...blocks[0],
          text: markdown,
        };
        state.blocksByParent[args.pageId] = [nextFirst, ...blocks.slice(1)];
      } else {
        state.blockCount += 1;
        updatedBlockId = `blk_md_${state.blockCount}`;
        state.blocksByParent[args.pageId] = [
          {
            id: updatedBlockId,
            type: "paragraph",
            text: markdown,
            hasChildren: false,
          },
        ];
      }

      if (!updatedBlockId) {
        throw new Error("invalid_provider_response");
      }
      return {
        pageId: args.pageId,
        markdown,
        updatedBlockId,
      };
    });
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

    return this.runNotionCachedOperation(args, method, normalizedArgs, (state) => {
      const database = this.getDatabaseById(state, args.databaseId);
      const response: NotionDatabase = {
        ...database,
        ...(typeof args.title === "string" ? { title: args.title } : {}),
        ...(Array.isArray(args.propertyNames)
          ? { propertyKeys: normalizePropertyNames(args.propertyNames) }
          : {}),
      };
      state.databases = state.databases.map((entry) =>
        entry.id === database.id ? response : entry,
      );
      return response;
    });
  }

  async appendBlockChildren(args: NotionAppendBlockChildrenArgs): Promise<NotionBlock[]> {
    const method = "notion.blocks.children.append";
    const normalizedArgs = {
      namespace: args.namespace,
      blockId: args.blockId,
      content: args.content,
    };

    return this.runNotionCachedOperation(args, method, normalizedArgs, (state) => {
      this.assertBlockParentExists(state, args.blockId);
      state.blockCount += 1;
      const block: NotionBlock = {
        id: `blk_append_${state.blockCount}`,
        type: "paragraph",
        text: args.content,
        hasChildren: false,
      };
      const existingChildren = state.blocksByParent[args.blockId] ?? [];
      state.blocksByParent[args.blockId] = [...existingChildren, block];
      return [block];
    });
  }

  async updateBlock(args: NotionUpdateBlockArgs): Promise<NotionBlock> {
    const method = "notion.blocks.update";
    const normalizedArgs = {
      namespace: args.namespace,
      blockId: args.blockId,
      content: args.content,
    };

    return this.runNotionCachedOperation(args, method, normalizedArgs, (state) => {
      const { parentId, index, block } = this.findBlockLocation(state, args.blockId);
      const updated: NotionBlock = {
        ...block,
        text: args.content,
      };
      state.blocksByParent[parentId] = state.blocksByParent[parentId]!.map((entry, entryIndex) =>
        entryIndex === index ? updated : entry,
      );
      return updated;
    });
  }

  async deleteBlock(args: NotionDeleteBlockArgs): Promise<NotionBlock> {
    const method = "notion.blocks.delete";
    const normalizedArgs = {
      namespace: args.namespace,
      blockId: args.blockId,
    };

    return this.runNotionCachedOperation(args, method, normalizedArgs, (state) => {
      const { parentId, index, block } = this.findBlockLocation(state, args.blockId);
      const removed: NotionBlock = {
        ...block,
        archived: true,
      };
      state.blocksByParent[parentId] = state.blocksByParent[parentId]!.filter(
        (_, entryIndex) => entryIndex !== index,
      );
      return removed;
    });
  }

  async createComment(args: NotionCreateCommentArgs): Promise<NotionComment> {
    const method = "notion.comments.create";
    const normalizedArgs = {
      namespace: args.namespace,
      pageId: args.pageId,
      content: args.content,
    };

    return this.runNotionCachedOperation(args, method, normalizedArgs, (state) => {
      this.getPageById(state, args.pageId);
      state.commentCount += 1;
      const response: NotionComment = {
        id: `cmt_created_${state.commentCount}`,
        pageId: args.pageId,
        content: args.content,
        createdBy: "keppo-automation",
      };
      state.comments.unshift(response);
      return response;
    });
  }

  seed(namespace: string, seed: Record<string, unknown>): void {
    const state = this.getState(namespace);

    if (Array.isArray(seed.pages)) {
      state.pages = seed.pages
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => ({
          id: String(entry.id ?? `page_${100 + index}`),
          title: String(entry.title ?? "Untitled"),
          ...(typeof entry.content === "string" ? { content: entry.content } : {}),
          ...(typeof entry.url === "string" ? { url: entry.url } : {}),
          ...(typeof entry.archived === "boolean" ? { archived: entry.archived } : {}),
          ...(entry.properties &&
          typeof entry.properties === "object" &&
          !Array.isArray(entry.properties)
            ? { properties: asRecord(entry.properties) }
            : {}),
        }));
    }

    if (Array.isArray(seed.databases)) {
      state.databases = seed.databases
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => ({
          id: String(entry.id ?? `db_${100 + index}`),
          title: String(entry.title ?? "Untitled Database"),
          propertyKeys: Array.isArray(entry.propertyKeys)
            ? entry.propertyKeys.map((value) => String(value))
            : Array.isArray(entry.properties)
              ? entry.properties.map((value) => String(value))
              : entry.properties &&
                  typeof entry.properties === "object" &&
                  !Array.isArray(entry.properties)
                ? Object.keys(entry.properties as Record<string, unknown>)
                : [],
          ...(typeof entry.parentPageId === "string" ? { parentPageId: entry.parentPageId } : {}),
          ...(typeof entry.url === "string" ? { url: entry.url } : {}),
        }));
    }

    if (
      seed.blocksByParent &&
      typeof seed.blocksByParent === "object" &&
      !Array.isArray(seed.blocksByParent)
    ) {
      const source = seed.blocksByParent as Record<string, unknown>;
      const next: Record<string, NotionBlock[]> = {};
      for (const [parentId, value] of Object.entries(source)) {
        if (!Array.isArray(value)) {
          continue;
        }
        next[parentId] = value
          .filter((entry): entry is Record<string, unknown> => {
            return !!entry && typeof entry === "object" && !Array.isArray(entry);
          })
          .map((entry, index) => ({
            id: String(entry.id ?? `${parentId}_blk_${index + 1}`),
            type: String(entry.type ?? "paragraph"),
            ...(typeof entry.text === "string" ? { text: entry.text } : {}),
            hasChildren: Boolean(entry.hasChildren ?? entry.has_children ?? false),
            ...(typeof entry.archived === "boolean" ? { archived: entry.archived } : {}),
          }));
      }
      state.blocksByParent = next;
    }

    if (Array.isArray(seed.comments)) {
      state.comments = seed.comments
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => ({
          id: String(entry.id ?? `cmt_${100 + index}`),
          pageId: String(entry.pageId ?? entry.parentId ?? ""),
          content: String(entry.content ?? ""),
          ...(typeof entry.createdBy === "string" ? { createdBy: entry.createdBy } : {}),
        }))
        .filter((entry) => entry.pageId.length > 0);
    }

    if (Array.isArray(seed.users)) {
      state.users = seed.users
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => ({
          id: String(entry.id ?? `usr_${100 + index}`),
          type: String(entry.type ?? "person"),
          name: String(entry.name ?? `User ${index + 1}`),
          ...(typeof entry.avatarUrl === "string"
            ? { avatarUrl: entry.avatarUrl }
            : typeof entry.avatar_url === "string"
              ? { avatarUrl: entry.avatar_url }
              : {}),
          ...(typeof entry.email === "string" ? { email: entry.email } : {}),
        }));
    }

    if (seed.botUser && typeof seed.botUser === "object" && !Array.isArray(seed.botUser)) {
      const botUser = seed.botUser as Record<string, unknown>;
      state.botUser = {
        id: String(botUser.id ?? "bot_100"),
        type: String(botUser.type ?? "bot"),
        name: String(botUser.name ?? "Keppo Bot"),
        ...(typeof botUser.avatarUrl === "string"
          ? { avatarUrl: botUser.avatarUrl }
          : typeof botUser.avatar_url === "string"
            ? { avatarUrl: botUser.avatar_url }
            : {}),
        ...(typeof botUser.email === "string" ? { email: botUser.email } : {}),
      };
    }

    if (typeof seed.forceRateLimit === "boolean") {
      state.forceRateLimit = seed.forceRateLimit;
    }
    if (typeof seed.forceTimeout === "boolean") {
      state.forceTimeout = seed.forceTimeout;
    }
  }

  protected createDefaultState(): NotionNamespaceState {
    const created: NotionNamespaceState = {
      pages: seedNotionPages().map((page) => ({ ...page })),
      databases: seedNotionDatabases().map((database) => ({ ...database })),
      blocksByParent: seedNotionBlocks(),
      comments: seedNotionComments().map((comment) => ({ ...comment })),
      users: seedNotionUsers().map((user) => ({ ...user })),
      botUser: { ...seedNotionBotUser() },
      pageCount: 0,
      blockCount: 0,
      databaseCount: 0,
      commentCount: 0,
      idempotentResponses: new Map(),
      forceRateLimit: false,
      forceTimeout: false,
    };

    return created;
  }

  private applyFailureFlags(state: NotionNamespaceState): void {
    if (state.forceRateLimit) {
      throw new Error("rate_limited");
    }
    if (state.forceTimeout) {
      throw new Error("gateway_timeout");
    }
  }

  private runNotionOperation<TResult>(
    args: { namespace?: string | undefined; accessToken?: string | null | undefined },
    method: string,
    normalizedArgs: unknown,
    execute: (state: NotionNamespaceState) => Promise<TResult> | TResult,
  ): Promise<TResult> {
    return this.runOperation({
      namespace: args.namespace,
      method,
      args: normalizedArgs,
      accessToken: args.accessToken,
      mapError: toProviderSdkError,
      before: (state) => this.applyFailureFlags(state),
      execute,
    });
  }

  private runNotionCachedOperation<TResult>(
    args: {
      namespace?: string | undefined;
      accessToken?: string | null | undefined;
      idempotencyKey?: string | undefined;
    },
    method: string,
    normalizedArgs: unknown,
    execute: (state: NotionNamespaceState) => Promise<TResult> | TResult,
  ): Promise<TResult> {
    return this.runCachedOperation({
      namespace: args.namespace,
      method,
      args: normalizedArgs,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      mapError: toProviderSdkError,
      before: (state) => this.applyFailureFlags(state),
      getCachedValue: (state) =>
        this.getIdempotentResponse<TResult>(state, method, args.idempotencyKey),
      setCachedValue: (state, response) =>
        this.setIdempotentResponse(state, method, args.idempotencyKey, response),
      execute,
    });
  }

  private filterPages(pages: NotionPage[], query: string, pageSizeRaw: number): NotionPage[] {
    const needle = query.toLowerCase().trim();
    const pageSize = Math.max(1, Math.min(100, Number(pageSizeRaw) || 20));
    return pages
      .filter((page) => {
        if (!needle) {
          return true;
        }
        return (
          page.title.toLowerCase().includes(needle) ||
          String(page.content ?? "")
            .toLowerCase()
            .includes(needle)
        );
      })
      .slice(0, pageSize);
  }

  private getPageById(state: NotionNamespaceState, pageId: string): NotionPage {
    const page = state.pages.find((entry) => entry.id === pageId);
    if (!page) {
      throw new Error("page_not_found");
    }
    return page;
  }

  private getDatabaseById(state: NotionNamespaceState, databaseId: string): NotionDatabase {
    const database = state.databases.find((entry) => entry.id === databaseId);
    if (!database) {
      throw new Error("database_not_found");
    }
    return database;
  }

  private findBlockLocation(
    state: NotionNamespaceState,
    blockId: string,
  ): { parentId: string; index: number; block: NotionBlock } {
    for (const [parentId, blocks] of Object.entries(state.blocksByParent)) {
      const index = blocks.findIndex((entry) => entry.id === blockId);
      if (index >= 0) {
        return {
          parentId,
          index,
          block: blocks[index]!,
        };
      }
    }
    throw new Error("block_not_found");
  }

  private getBlockById(state: NotionNamespaceState, blockId: string): NotionBlock {
    return this.findBlockLocation(state, blockId).block;
  }

  private assertBlockParentExists(state: NotionNamespaceState, blockId: string): void {
    if (state.blocksByParent[blockId]) {
      return;
    }
    const page = state.pages.find((entry) => entry.id === blockId);
    if (page) {
      state.blocksByParent[blockId] = [];
      return;
    }
    throw new Error("block_not_found");
  }
}

const toRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const readRichTextContent = (value: unknown): string => {
  if (!Array.isArray(value)) {
    return "";
  }
  const first = value.find(
    (entry) => !!entry && typeof entry === "object" && !Array.isArray(entry),
  );
  if (!first) {
    return "";
  }
  const firstRecord = first as Record<string, unknown>;
  if (typeof firstRecord.plain_text === "string") {
    return firstRecord.plain_text;
  }
  const text = toRecord(firstRecord.text);
  return typeof text.content === "string" ? text.content : "";
};

const readDatabaseTitle = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return "";
      }
      const record = entry as Record<string, unknown>;
      const text = toRecord(record.text);
      return typeof text.content === "string" ? text.content : "";
    })
    .join("")
    .trim();
};

const toFakeNotionClient = (
  engine: InMemoryNotionEngine,
  accessToken: string,
  namespace?: string,
  options?: NotionClientOptions,
): NotionClient => {
  return {
    search: async ({ query, page_size }) => {
      const results = await engine.searchPages({
        accessToken,
        namespace,
        query,
        pageSize: page_size,
      });
      return { results };
    },
    pages: {
      retrieve: async ({ page_id }) => {
        return await engine.getPage({
          accessToken,
          namespace,
          pageId: page_id,
        });
      },
      create: async (params) => {
        const properties = toRecord(params.properties);
        const titleProperty = toRecord(properties.title);
        const title = readRichTextContent(titleProperty.title);
        const children = Array.isArray(params.children) ? params.children : [];
        const firstChild = toRecord(children[0]);
        const paragraph = toRecord(firstChild.paragraph);
        const content = readRichTextContent(paragraph.rich_text);
        return await engine.createPage({
          accessToken,
          namespace,
          title,
          content,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
      },
      update: async (params) => {
        const properties = toRecord(params.properties);
        const titleProperty = toRecord(properties.title);
        const title = readRichTextContent(titleProperty.title);
        const hasTitle = Object.prototype.hasOwnProperty.call(properties, "title");
        const pageId = String(params.page_id ?? "");
        const parent = toRecord(params.parent);
        const parentPageId =
          typeof parent.page_id === "string" && parent.page_id.trim().length > 0
            ? parent.page_id.trim()
            : undefined;

        let response: NotionPage | null = null;
        if (parentPageId) {
          response = await engine.movePage({
            accessToken,
            namespace,
            pageId,
            parentPageId,
            ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
          });
        }
        if (hasTitle || typeof params.archived === "boolean") {
          response = await engine.updatePage({
            accessToken,
            namespace,
            pageId,
            ...(hasTitle ? { title } : {}),
            ...(typeof params.archived === "boolean" ? { archived: params.archived } : {}),
            ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
          });
        }
        if (response) {
          return response;
        }
        throw new Error("invalid_request");
      },
      move: async ({ page_id, parent_page_id }) => {
        return await engine.movePage({
          accessToken,
          namespace,
          pageId: page_id,
          parentPageId: parent_page_id,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
      },
      properties: {
        retrieve: async ({ page_id, property_id }) => {
          const property = await engine.getPageProperty({
            accessToken,
            namespace,
            pageId: page_id,
            propertyId: property_id,
          });
          return {
            object: "property_item",
            id: property.propertyId,
            type: property.type,
            [property.type]: property.value,
          };
        },
      },
    },
    databases: {
      retrieve: async ({ database_id }) => {
        return await engine.getDatabase({
          accessToken,
          namespace,
          databaseId: database_id,
        });
      },
      query: async ({ database_id, query, page_size }) => {
        const results = await engine.queryDatabase({
          accessToken,
          namespace,
          databaseId: database_id,
          query: query ?? "",
          pageSize: page_size,
        });
        return { results };
      },
      create: async (params) => {
        const properties = toRecord(params.properties);
        const propertyNames = Object.keys(properties);
        const parent = toRecord(params.parent);
        return await engine.createDatabase({
          accessToken,
          namespace,
          title: readDatabaseTitle(params.title),
          propertyNames,
          ...(typeof parent.page_id === "string" ? { parentPageId: parent.page_id } : {}),
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
      },
      update: async (params) => {
        const properties = toRecord(params.properties);
        const propertyNames = Object.keys(properties);
        const database = await engine.updateDatabase({
          accessToken,
          namespace,
          databaseId: String(params.database_id ?? ""),
          ...(typeof params.title !== "undefined"
            ? { title: readDatabaseTitle(params.title) }
            : {}),
          ...(propertyNames.length > 0 ? { propertyNames } : {}),
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return database;
      },
    },
    blocks: {
      retrieve: async ({ block_id }) => {
        return await engine.getBlock({
          accessToken,
          namespace,
          blockId: block_id,
        });
      },
      update: async (params) => {
        const paragraph = toRecord(params.paragraph);
        const content = readRichTextContent(paragraph.rich_text);
        return await engine.updateBlock({
          accessToken,
          namespace,
          blockId: String(params.block_id ?? ""),
          content,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
      },
      delete: async ({ block_id }) => {
        return await engine.deleteBlock({
          accessToken,
          namespace,
          blockId: block_id,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
      },
      children: {
        list: async ({ block_id, page_size }) => {
          const results = await engine.getBlockChildren({
            accessToken,
            namespace,
            blockId: block_id,
            pageSize: page_size,
          });
          return { results };
        },
        append: async ({ block_id, children }) => {
          const firstChild = Array.isArray(children) ? toRecord(children[0]) : {};
          const paragraph = toRecord(firstChild.paragraph);
          const content = readRichTextContent(paragraph.rich_text);
          const results = await engine.appendBlockChildren({
            accessToken,
            namespace,
            blockId: block_id,
            content,
            ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
          });
          return { results };
        },
      },
    },
    comments: {
      list: async ({ block_id, page_size }) => {
        const results = await engine.listComments({
          accessToken,
          namespace,
          pageId: block_id,
          pageSize: page_size,
        });
        return { results };
      },
      retrieve: async ({ comment_id }) => {
        return await engine.getComment({
          accessToken,
          namespace,
          commentId: comment_id,
        });
      },
      create: async ({ parent, rich_text }) => {
        return await engine.createComment({
          accessToken,
          namespace,
          pageId: parent.page_id,
          content: readRichTextContent(rich_text),
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
      },
    },
    users: {
      list: async ({ page_size }) => {
        const results = await engine.listUsers({
          accessToken,
          namespace,
          pageSize: page_size,
        });
        return { results };
      },
      retrieve: async ({ user_id }) => {
        return await engine.getUser({
          accessToken,
          namespace,
          userId: user_id,
        });
      },
      me: async () => {
        return await engine.getBotUser({
          accessToken,
          namespace,
        });
      },
    },
  };
};

const createNoopCallLog = (): ProviderSdkCallLog => {
  return {
    capture: () => {},
    list: () => [],
    reset: () => {},
  };
};

export class FakeNotionClientStore {
  private readonly engine = new InMemoryNotionEngine({ callLog: createNoopCallLog() });

  readonly createClient: CreateNotionClient = (accessToken, namespace, options) => {
    return toFakeNotionClient(this.engine, accessToken, namespace, options);
  };

  reset(namespace?: string): void {
    this.engine.reset(namespace);
  }

  seed(namespace: string, seed: Record<string, unknown>): void {
    this.engine.seed(namespace, seed);
  }
}

export const createFakeNotionClientStore = (): FakeNotionClientStore => {
  return new FakeNotionClientStore();
};

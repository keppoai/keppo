import type { CreatePageResponse, PageObjectResponse, SearchResponse } from "@notionhq/client";
import type { ProviderSdkPort } from "../port.js";

type NotionSearchPage = Extract<SearchResponse["results"][number], { object: "page" }>;
type NotionCreatedPage = Extract<CreatePageResponse, { object: "page" }>;

export type NotionSdkContext = {
  accessToken: string;
  namespace?: string | undefined;
};

export type NotionPage = {
  id: NotionSearchPage["id"];
  title: string;
  content?: string;
  archived?: boolean;
  parentPageId?: string;
  properties?: Record<string, unknown>;
  url?: PageObjectResponse["url"];
};

export type NotionSearchPagesArgs = NotionSdkContext & {
  query: string;
  pageSize: number;
};

export type NotionCreatePageArgs = NotionSdkContext & {
  title: string;
  content: string;
  idempotencyKey?: string | undefined;
};

export type NotionCreatePageResponse = {
  id: NotionCreatedPage["id"];
  title: string;
  content: string;
  url?: PageObjectResponse["url"];
};

export type NotionGetPageArgs = NotionSdkContext & {
  pageId: string;
};

export type NotionGetPageAsMarkdownArgs = NotionSdkContext & {
  pageId: string;
};

export type NotionPageMarkdown = {
  pageId: string;
  title: string;
  markdown: string;
  blockCount: number;
};

export type NotionUpdatePageArgs = NotionSdkContext & {
  pageId: string;
  title?: string | undefined;
  archived?: boolean | undefined;
  idempotencyKey?: string | undefined;
};

export type NotionMovePageArgs = NotionSdkContext & {
  pageId: string;
  parentPageId: string;
  idempotencyKey?: string | undefined;
};

export type NotionUpdatePageMarkdownArgs = NotionSdkContext & {
  pageId: string;
  markdown: string;
  idempotencyKey?: string | undefined;
};

export type NotionUpdatePageMarkdownResponse = {
  pageId: string;
  markdown: string;
  updatedBlockId: string;
};

export type NotionDatabase = {
  id: string;
  title: string;
  propertyKeys: string[];
  parentPageId?: string;
  url?: string;
};

export type NotionGetDatabaseArgs = NotionSdkContext & {
  databaseId: string;
};

export type NotionQueryDatabaseArgs = NotionSdkContext & {
  databaseId: string;
  query: string;
  pageSize: number;
};

export type NotionBlock = {
  id: string;
  type: string;
  text?: string;
  hasChildren: boolean;
  archived?: boolean;
};

export type NotionGetBlockChildrenArgs = NotionSdkContext & {
  blockId: string;
  pageSize: number;
};

export type NotionGetBlockArgs = NotionSdkContext & {
  blockId: string;
};

export type NotionAppendBlockChildrenArgs = NotionSdkContext & {
  blockId: string;
  content: string;
  idempotencyKey?: string | undefined;
};

export type NotionUpdateBlockArgs = NotionSdkContext & {
  blockId: string;
  content: string;
  idempotencyKey?: string | undefined;
};

export type NotionDeleteBlockArgs = NotionSdkContext & {
  blockId: string;
  idempotencyKey?: string | undefined;
};

export type NotionComment = {
  id: string;
  pageId: string;
  content: string;
  createdBy?: string;
};

export type NotionPageProperty = {
  pageId: string;
  propertyId: string;
  type: string;
  value: unknown;
};

export type NotionUser = {
  id: string;
  type: string;
  name: string;
  avatarUrl?: string;
  email?: string;
};

export type NotionCreateCommentArgs = NotionSdkContext & {
  pageId: string;
  content: string;
  idempotencyKey?: string | undefined;
};

export type NotionListCommentsArgs = NotionSdkContext & {
  pageId: string;
  pageSize: number;
};

export type NotionCreateDatabaseArgs = NotionSdkContext & {
  title: string;
  propertyNames: string[];
  parentPageId?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type NotionUpdateDatabaseArgs = NotionSdkContext & {
  databaseId: string;
  title?: string | undefined;
  propertyNames?: string[] | undefined;
  idempotencyKey?: string | undefined;
};

export type NotionGetPagePropertyArgs = NotionSdkContext & {
  pageId: string;
  propertyId: string;
};

export type NotionListUsersArgs = NotionSdkContext & {
  pageSize: number;
};

export type NotionGetUserArgs = NotionSdkContext & {
  userId: string;
};

export type NotionGetCommentArgs = NotionSdkContext & {
  commentId: string;
};

export interface NotionSdkPort extends ProviderSdkPort {
  searchPages(args: NotionSearchPagesArgs): Promise<NotionPage[]>;
  getPage(args: NotionGetPageArgs): Promise<NotionPage>;
  getPageAsMarkdown(args: NotionGetPageAsMarkdownArgs): Promise<NotionPageMarkdown>;
  queryDatabase(args: NotionQueryDatabaseArgs): Promise<NotionPage[]>;
  getDatabase(args: NotionGetDatabaseArgs): Promise<NotionDatabase>;
  getBlockChildren(args: NotionGetBlockChildrenArgs): Promise<NotionBlock[]>;
  getBlock(args: NotionGetBlockArgs): Promise<NotionBlock>;
  getComment(args: NotionGetCommentArgs): Promise<NotionComment>;
  listComments(args: NotionListCommentsArgs): Promise<NotionComment[]>;
  getPageProperty(args: NotionGetPagePropertyArgs): Promise<NotionPageProperty>;
  listUsers(args: NotionListUsersArgs): Promise<NotionUser[]>;
  getUser(args: NotionGetUserArgs): Promise<NotionUser>;
  getBotUser(args: NotionSdkContext): Promise<NotionUser>;
  createPage(args: NotionCreatePageArgs): Promise<NotionCreatePageResponse>;
  movePage(args: NotionMovePageArgs): Promise<NotionPage>;
  createDatabase(args: NotionCreateDatabaseArgs): Promise<NotionDatabase>;
  updatePage(args: NotionUpdatePageArgs): Promise<NotionPage>;
  updatePageMarkdown(args: NotionUpdatePageMarkdownArgs): Promise<NotionUpdatePageMarkdownResponse>;
  updateDatabase(args: NotionUpdateDatabaseArgs): Promise<NotionDatabase>;
  appendBlockChildren(args: NotionAppendBlockChildrenArgs): Promise<NotionBlock[]>;
  updateBlock(args: NotionUpdateBlockArgs): Promise<NotionBlock>;
  deleteBlock(args: NotionDeleteBlockArgs): Promise<NotionBlock>;
  createComment(args: NotionCreateCommentArgs): Promise<NotionComment>;
}

const _notionTypeCompatibilityCheck: Pick<NotionSearchPage, "id"> = {} as NotionPage;
void _notionTypeCompatibilityCheck;

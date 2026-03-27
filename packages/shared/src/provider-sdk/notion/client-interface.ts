import type { BlockObjectRequest } from "@notionhq/client";

export type NotionClientOptions = {
  requestContext?: string;
  idempotencyKey?: string | undefined;
};

export interface NotionClient {
  search(params: {
    query: string;
    page_size: number;
    filter: {
      property: "object";
      value: "page";
    };
  }): Promise<{ results: unknown[] }>;
  pages: {
    retrieve(params: { page_id: string }): Promise<unknown>;
    create(params: Record<string, unknown>): Promise<unknown>;
    update(params: Record<string, unknown>): Promise<unknown>;
    move(params: { page_id: string; parent_page_id: string }): Promise<unknown>;
    properties: {
      retrieve(params: { page_id: string; property_id: string }): Promise<unknown>;
    };
  };
  databases: {
    retrieve(params: { database_id: string }): Promise<unknown>;
    query(params: {
      database_id: string;
      page_size: number;
      query?: string | undefined;
    }): Promise<{ results: unknown[] }>;
    create(params: Record<string, unknown>): Promise<unknown>;
    update(params: Record<string, unknown>): Promise<unknown>;
  };
  blocks: {
    retrieve(params: { block_id: string }): Promise<unknown>;
    update(params: Record<string, unknown>): Promise<unknown>;
    delete(params: { block_id: string }): Promise<unknown>;
    children: {
      list(params: { block_id: string; page_size: number }): Promise<{ results: unknown[] }>;
      append(params: {
        block_id: string;
        children: BlockObjectRequest[];
      }): Promise<{ results: unknown[] }>;
    };
  };
  comments: {
    list(params: { block_id: string; page_size: number }): Promise<{ results: unknown[] }>;
    retrieve(params: { comment_id: string }): Promise<unknown>;
    create(params: {
      parent: { page_id: string };
      rich_text: Array<{
        type: "text";
        text: {
          content: string;
        };
      }>;
    }): Promise<unknown>;
  };
  users: {
    list(params: { page_size: number }): Promise<{ results: unknown[] }>;
    retrieve(params: { user_id: string }): Promise<unknown>;
    me(): Promise<unknown>;
  };
}

export type CreateNotionClient = (
  accessToken: string,
  namespace?: string,
  options?: NotionClientOptions,
) => NotionClient;

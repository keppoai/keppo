import { createFromSource } from "fumadocs-core/search/server";
import type { QueryOptions, SearchServer } from "fumadocs-core/search/server";
import type { LoaderConfig, LoaderOutput } from "fumadocs-core/source";
import type { StructuredData } from "fumadocs-core/mdx-plugins";

const EMPTY_STRUCTURED_DATA: StructuredData = {
  headings: [],
  contents: [],
};

const isStructuredData = (value: unknown): value is StructuredData => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate["headings"]) && Array.isArray(candidate["contents"]);
};

export const createDocsSearchServer = <C extends LoaderConfig>(source: LoaderOutput<C>) => {
  return createFromSource(source, {
    language: "english",
    buildIndex(page) {
      const rootSlug = page.slugs[0] ?? "docs";
      const structuredData =
        typeof page.data === "object" &&
        page.data !== null &&
        "structuredData" in page.data &&
        isStructuredData(page.data.structuredData)
          ? page.data.structuredData
          : EMPTY_STRUCTURED_DATA;

      return {
        title: page.data.title ?? "Untitled page",
        url: page.url,
        id: page.url,
        structuredData,
        tag: rootSlug,
        ...(page.data.description ? { description: page.data.description } : {}),
      };
    },
  });
};

type DocsSearchServer = SearchServer<QueryOptions>;

let searchServerPromise: Promise<DocsSearchServer> | null = null;

export const getDocsSearchServer = async (): Promise<DocsSearchServer> => {
  searchServerPromise ??= import("../../../src/lib/docs/source").then(({ source }) =>
    createDocsSearchServer(source),
  );
  return await searchServerPromise;
};

export const searchDocsWithServer = async (query: string, searchServer: DocsSearchServer) => {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    return [];
  }

  const directResults = await searchServer.search(trimmedQuery);
  if (directResults.length > 0 || !/\s/.test(trimmedQuery)) {
    return directResults;
  }

  const terms = Array.from(
    new Set(
      trimmedQuery
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length > 0),
    ),
  ).sort((left, right) => right.length - left.length);

  const fallbackResults = await Promise.all(terms.map((term) => searchServer.search(term)));
  const deduped = new Map<string, (typeof directResults)[number]>();

  fallbackResults.flat().forEach((result) => {
    deduped.set(result.id, result);
  });

  return Array.from(deduped.values());
};

export const searchDocs = async (query: string) => {
  return await searchDocsWithServer(query, await getDocsSearchServer());
};

export const handleDocsSearchRequest = async (request: Request): Promise<Response> => {
  const query = new URL(request.url).searchParams.get("query") ?? "";
  return Response.json(await searchDocs(query));
};

export const dispatchStartOwnedDocsSearchRequest = async (
  request: Request,
): Promise<Response | null> => {
  if (request.method === "GET" && new URL(request.url).pathname === "/api/search") {
    return await handleDocsSearchRequest(request);
  }

  return null;
};

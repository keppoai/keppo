import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fumadocs from "fumadocs-mdx/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import posthogRollupPlugin from "@posthog/rollup-plugin";
import { defineConfig, runnerImport, type PluginOption } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import dyadComponentTagger from "@dyad-sh/react-vite-component-tagger";
import * as sourceConfig from "./source.config";
import { getKeppoClientEnvDefine } from "./vite.keppo-env";

type UnifiedProtocolBoundaryModule = {
  dispatchUnifiedProtocolRequest: (request: Request) => Promise<Response | null>;
};

let unifiedProtocolBoundaryModulePromise: Promise<UnifiedProtocolBoundaryModule> | null = null;
const UNIFIED_PROTOCOL_BOUNDARY_MODULE_PATH = path.resolve(
  process.cwd(),
  "src/lib/unified-protocol-boundary.ts",
);

const createApiBridgePlugin = () => ({
  name: "keppo-protocol-boundary",
  configureServer(server: import("vite").ViteDevServer) {
    installApiBridgeMiddleware(server.middlewares, loadUnifiedProtocolBoundaryModule);
  },
  configurePreviewServer(server: import("vite").PreviewServer) {
    installApiBridgeMiddleware(server.middlewares, async () => {
      throw new Error(
        "keppo-protocol-boundary preview middleware requires a built server entry instead of loading TypeScript source directly",
      );
    });
  },
});

const loadUnifiedProtocolBoundaryModule = async (): Promise<UnifiedProtocolBoundaryModule> => {
  unifiedProtocolBoundaryModulePromise ??= runnerImport(UNIFIED_PROTOCOL_BOUNDARY_MODULE_PATH, {
    root: process.cwd(),
  }).then((result) => result.module as UnifiedProtocolBoundaryModule);
  return await unifiedProtocolBoundaryModulePromise;
};

type ApiBridgeMiddleware = (
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  next: (err?: Error) => void,
) => void | Promise<void>;

type MiddlewareStack = {
  use: (middleware: ApiBridgeMiddleware) => void;
};

const canHaveRequestBody = (method: string): boolean => {
  return method !== "GET" && method !== "HEAD";
};

const installApiBridgeMiddleware = (
  middlewares: MiddlewareStack,
  loadUnifiedProtocolBoundaryModule: () => Promise<UnifiedProtocolBoundaryModule>,
) => {
  middlewares.use(async (req, res, next) => {
    const pathname = req.url ? new URL(req.url, "http://localhost").pathname : "";
    const protocolLikePath =
      pathname === "/api" ||
      pathname.startsWith("/api/") ||
      pathname === "/billing" ||
      pathname.startsWith("/billing/") ||
      pathname === "/downloads" ||
      pathname.startsWith("/downloads/") ||
      pathname === "/internal" ||
      pathname.startsWith("/internal/") ||
      pathname === "/mcp" ||
      pathname.startsWith("/mcp/") ||
      pathname === "/oauth" ||
      pathname.startsWith("/oauth/") ||
      pathname === "/webhooks" ||
      pathname.startsWith("/webhooks/");
    if (!protocolLikePath) {
      next();
      return;
    }

    try {
      const { dispatchUnifiedProtocolRequest } = await loadUnifiedProtocolBoundaryModule();
      const origin = `http://${req.headers.host ?? "localhost:3000"}`;
      const method = req.method ?? "GET";
      const requestInit: RequestInit & { duplex?: "half" } = {
        method,
        headers: req.headers as HeadersInit,
      };
      if (canHaveRequestBody(method) && req.readable) {
        requestInit.body = req as unknown as BodyInit;
        requestInit.duplex = "half";
      }
      const request = new Request(new URL(req.url ?? pathname, origin), {
        method: req.method ?? "GET",
        ...requestInit,
      });
      const response = await dispatchUnifiedProtocolRequest(request);
      if (!response) {
        next();
        return;
      }

      res.statusCode = response.status;
      const setCookie =
        typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
      for (const [key, value] of response.headers.entries()) {
        if (key.toLowerCase() === "set-cookie") {
          continue;
        }
        res.setHeader(key, value);
      }
      if (setCookie.length > 0) {
        res.setHeader("set-cookie", setCookie);
      }

      if (!response.body || req.method === "HEAD") {
        res.end();
        return;
      }

      Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>).pipe(res);
    } catch (error) {
      next(error as Error);
    }
  });
};

export default defineConfig(async ({ command }) => {
  const environment = process.env["VITE_KEPPO_ENVIRONMENT"];
  const includeBundledRuntimeEnvServerAssets = command !== "serve";
  const shouldShipSourceMaps =
    environment === "preview" || environment === "staging" || environment === "production";
  const posthogProjectId = process.env["POSTHOG_PROJECT_ID"];
  const posthogPersonalApiKey = process.env["POSTHOG_PERSONAL_API_KEY"];
  const canUploadSourceMaps =
    shouldShipSourceMaps &&
    typeof posthogProjectId === "string" &&
    posthogProjectId.trim().length > 0 &&
    typeof posthogPersonalApiKey === "string" &&
    posthogPersonalApiKey.trim().length > 0;
  const releaseVersion =
    process.env["KEPPO_RELEASE_VERSION"] ??
    process.env["VERCEL_GIT_COMMIT_SHA"] ??
    process.env["VERCEL_DEPLOYMENT_ID"];
  const plugins: PluginOption[] = [
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    await fumadocs(sourceConfig, {
      outDir: "./.source",
    }),
    tailwindcss(),
    createApiBridgePlugin(),
    tanstackStart({
      router: {
        routesDirectory: "../app/routes",
        generatedRouteTree: "../app/routeTree.gen.ts",
        quoteStyle: "double",
        semicolons: true,
      },
    }),
    nitro(),
    dyadComponentTagger(),
    react(),
  ];

  if (canUploadSourceMaps) {
    const sourcemaps: {
      enabled: true;
      releaseName: string;
      deleteAfterUpload: false;
      releaseVersion?: string;
    } = {
      enabled: true,
      releaseName: process.env["KEPPO_RELEASE_NAME"] ?? "@keppo/web",
      deleteAfterUpload: false,
    };
    if (typeof releaseVersion === "string" && releaseVersion.trim().length > 0) {
      sourcemaps.releaseVersion = releaseVersion;
    }

    const posthogOptions: {
      personalApiKey: string;
      projectId: string;
      host?: string;
      sourcemaps: {
        enabled: true;
        releaseName: string;
        deleteAfterUpload: false;
        releaseVersion?: string;
      };
    } = {
      personalApiKey: posthogPersonalApiKey,
      projectId: posthogProjectId,
      sourcemaps,
    };
    if (
      typeof process.env["POSTHOG_HOST"] === "string" &&
      process.env["POSTHOG_HOST"].trim().length > 0
    ) {
      posthogOptions.host = process.env["POSTHOG_HOST"];
    }

    plugins.push(posthogRollupPlugin(posthogOptions) as PluginOption);
  }

  return {
    define: {
      ...getKeppoClientEnvDefine(),
    },
    publicDir: "./public",
    build: {
      sourcemap: shouldShipSourceMaps,
    },
    nitro: {
      preset: "vercel",
      serverAssets: includeBundledRuntimeEnvServerAssets
        ? [
            {
              baseName: "runtime-env",
              dir: "../..",
              pattern: ".env.{preview,staging,production}",
            },
          ]
        : [],
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "fumadocs-mdx:collections/browser": path.resolve(__dirname, "./.source/browser.ts"),
        "fumadocs-mdx:collections/server": path.resolve(__dirname, "./.source/server.ts"),
      },
      dedupe: ["react", "react-dom"],
    },
    server: {
      fs: {
        allow: ["..", "../.."],
      },
    },
    plugins,
  };
});

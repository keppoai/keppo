import NextAuth from "next-auth";
import { getAuthOptions, hasAuthConfiguration } from "@/lib/auth";

const buildMissingConfigResponse = () =>
  Response.json(
    {
      ok: false,
      error: {
        code: "auth_not_configured",
        title: "GitHub auth is not configured",
        summary: "Izzy cannot start the GitHub App login flow until its auth env vars are set.",
        nextSteps: ["Set the required GitHub App env vars for Izzy.", "Try signing in again."],
        technicalDetails: null,
      },
    },
    { status: 503 },
  );

export async function GET(
  request: Request,
  context: { params: Promise<Record<string, string[]>> },
) {
  if (!hasAuthConfiguration()) {
    return buildMissingConfigResponse();
  }
  const handler = NextAuth(getAuthOptions());
  return await handler(request, context);
}

export async function POST(
  request: Request,
  context: { params: Promise<Record<string, string[]>> },
) {
  if (!hasAuthConfiguration()) {
    return buildMissingConfigResponse();
  }
  const handler = NextAuth(getAuthOptions());
  return await handler(request, context);
}

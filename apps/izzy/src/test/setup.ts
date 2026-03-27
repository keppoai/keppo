import "@testing-library/jest-dom/vitest";

process.env.GITHUB_ID ??= "github-id";
process.env.GITHUB_SECRET ??= "github-secret";
process.env.NEXTAUTH_SECRET ??= "nextauth-secret";
process.env.NEXTAUTH_URL ??= "http://localhost:3201";
process.env.IZZY_ALLOWED_GITHUB_USERS ??= "will";
process.env.IZZY_OPENAI_API_KEY ??= "openai-key";

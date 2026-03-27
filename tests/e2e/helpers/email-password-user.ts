import { resolveAuthBaseUrl } from "./auth-topology";

export const ensureEmailPasswordUser = async (params: {
  dashboardBaseUrl: string;
  headers: Record<string, string>;
  email: string;
  password: string;
  name: string;
}): Promise<void> => {
  const authBaseUrl = resolveAuthBaseUrl({
    dashboardBaseUrl: params.dashboardBaseUrl,
  });
  const response = await fetch(`${authBaseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: params.dashboardBaseUrl,
      ...params.headers,
    },
    body: JSON.stringify({
      name: params.name,
      email: params.email,
      password: params.password,
    }),
  });

  if (response.ok) {
    return;
  }

  const body = (await response.text()).toLowerCase();
  if (response.status === 422 && body.includes("already exists")) {
    return;
  }

  throw new Error(`Failed to provision email/password user ${params.email}: ${response.status}`);
};

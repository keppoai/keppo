import type { LaunchContext } from "./session";

export const submitHelperCallback = async (params: LaunchContext & { callbackUrl: string }) => {
  const response = await fetch(params.callbackSubmitUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      helper_session_token: params.helperSessionToken,
      callback_url: params.callbackUrl,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Helper callback submission failed with ${response.status}.`);
  }
  return (await response.json()) as unknown;
};

export type LaunchContext = {
  helperSessionToken: string;
  oauthStartUrl: string;
  callbackSubmitUrl: string;
};

const readParam = (url: URL, key: string): string => {
  const value = url.searchParams.get(key)?.trim() ?? "";
  return value;
};

export const readLaunchContext = (): LaunchContext | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const url = new URL(window.location.href);
  const helperSessionToken = readParam(url, "session_token");
  const oauthStartUrl = readParam(url, "oauth_start_url");
  const callbackSubmitUrl = readParam(url, "callback_submit_url");
  if (!helperSessionToken || !oauthStartUrl || !callbackSubmitUrl) {
    return null;
  }
  return {
    helperSessionToken,
    oauthStartUrl,
    callbackSubmitUrl,
  };
};

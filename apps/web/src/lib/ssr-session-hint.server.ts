import { getStartContext } from "@tanstack/start-storage-context";
import { hasBetterAuthSessionCookie } from "./better-auth-cookie";

export const getSSRSessionHint = (): boolean | null => {
  try {
    return hasBetterAuthSessionCookie(getStartContext().request.headers.get("cookie"));
  } catch {
    return null;
  }
};

export const getRootDocumentSessionAttributes = (): { "data-has-session": "" } | {} => {
  return getSSRSessionHint() ? { "data-has-session": "" } : {};
};

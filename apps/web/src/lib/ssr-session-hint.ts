import { createIsomorphicFn } from "@tanstack/react-start";
import { getStartContext } from "@tanstack/start-storage-context";
import { hasBetterAuthSessionCookie } from "./better-auth-cookie";
import { clearDocumentSessionHint, hasDocumentSessionHint } from "./document-session-hint";

export const getSSRSessionHint = createIsomorphicFn()
  .client(() => null as boolean | null)
  .server(() => {
    try {
      return hasBetterAuthSessionCookie(getStartContext().request.headers.get("cookie"));
    } catch {
      return null;
    }
  });

export { clearDocumentSessionHint, hasDocumentSessionHint };

export const resolveSessionHintForRender = (): boolean => {
  return getSSRSessionHint() ?? hasDocumentSessionHint();
};

export const getRootDocumentSessionAttributes = (): { "data-has-session": "" } | {} => {
  return getSSRSessionHint() ? { "data-has-session": "" } : {};
};

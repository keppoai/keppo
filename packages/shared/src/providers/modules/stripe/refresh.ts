import { createManagedOAuthRefreshFacet } from "../oauth.js";
import { stripeManagedOAuthConfig } from "./auth.js";

export const refresh = createManagedOAuthRefreshFacet("stripe", stripeManagedOAuthConfig);

import { createManagedOAuthRefreshFacet } from "../oauth.js";
import { githubManagedOAuthConfig } from "./auth.js";

export const refresh = createManagedOAuthRefreshFacet("github", githubManagedOAuthConfig);

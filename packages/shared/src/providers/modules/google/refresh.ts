import { createManagedOAuthRefreshFacet } from "../oauth.js";
import { googleManagedOAuthConfig } from "./auth.js";

export const refresh = createManagedOAuthRefreshFacet("google", googleManagedOAuthConfig);

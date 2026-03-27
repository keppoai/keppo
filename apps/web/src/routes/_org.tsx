import { useEffect } from "react";
import { Outlet, createRoute, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { rootRoute } from "./__root";
import { useAuth } from "@/hooks/use-auth";
import { resolveOrgRedirectHref } from "@/lib/route-redirection";

export const orgLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$orgSlug",
  component: OrgLayout,
});

function OrgLayout() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { orgSlug } = useParams({ from: orgLayoutRoute.id });

  useEffect(() => {
    const href = resolveOrgRedirectHref({
      pathname: location.pathname,
      requestedOrgSlug: orgSlug,
      sessionOrgSlug: auth.getOrgSlug(),
      search: location.searchStr,
      hash: location.hash,
    });
    if (!href) {
      return;
    }

    void navigate({
      replace: true,
      href,
    });
  }, [auth, location.hash, location.pathname, location.searchStr, navigate, orgSlug]);

  return <Outlet />;
}

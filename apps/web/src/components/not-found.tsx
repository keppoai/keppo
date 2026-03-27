import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useRouteParams } from "@/hooks/use-route-params";

export function NotFound() {
  const prefersReducedMotion = useReducedMotion();
  const { buildWorkspacePath } = useRouteParams();
  const motionProps = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 10 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.3, ease: "easeOut" as const },
      };

  return (
    <motion.div
      className="flex min-h-[60vh] flex-col items-center justify-center text-center px-4"
      {...motionProps}
    >
      <img
        src="/illustrations/404.png"
        alt="Illustration for a page not found state"
        className="mb-6 h-auto w-[250px] max-w-full object-contain"
        loading="lazy"
      />
      <p className="text-sm font-medium text-muted-foreground mb-1">404</p>
      <h1 className="text-2xl font-bold tracking-tight mb-2">Page not found</h1>
      <p className="text-muted-foreground text-sm max-w-md mb-6">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Button nativeButton={false} render={<Link to={buildWorkspacePath()} />}>
        Go to Dashboard
      </Button>
    </motion.div>
  );
}

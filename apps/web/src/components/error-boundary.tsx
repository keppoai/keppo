import React from "react";
import { Button } from "@/components/ui/button";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";
import { toUserFacingError } from "@/lib/user-facing-errors";
import { captureDashboardException } from "@/posthog";

type ErrorBoundaryProps = {
  children: React.ReactNode;
  boundary?: "app" | "layout";
  fallback?: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    console.error("dashboard.runtime.error_boundary", error);
    captureDashboardException(error, {
      boundary: this.props.boundary ?? "app",
      component_stack: errorInfo.componentStack,
    });
  }

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }
      const boundary = this.props.boundary ?? "app";
      const isLayout = boundary === "layout";
      const parsedError = toUserFacingError(this.state.error, {
        fallback: isLayout
          ? "An unexpected error interrupted this page."
          : "An unexpected dashboard error occurred.",
        audience: isLayout ? "operator" : "public",
      });
      return (
        <div
          className={
            isLayout
              ? "flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center"
              : "flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center"
          }
        >
          <img
            src="/illustrations/error.png"
            alt="Illustration of troubleshooting an unexpected error"
            className={
              isLayout
                ? "h-auto w-[200px] max-w-full object-contain"
                : "h-auto w-[200px] max-w-full object-contain"
            }
            loading="lazy"
          />
          <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            {parsedError.nextSteps.join(" ")}
          </p>
          {this.state.error ? (
            <div className="w-full max-w-xl text-left">
              <UserFacingErrorView error={parsedError} variant={isLayout ? "page" : "inline"} />
            </div>
          ) : null}
          <Button
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload page
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

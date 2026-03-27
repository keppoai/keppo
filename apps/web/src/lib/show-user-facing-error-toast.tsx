import { toast } from "sonner";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";
import { toUserFacingError, type UserFacingError } from "./user-facing-errors";

export const showUserFacingErrorToast = (
  error: unknown,
  options?: {
    fallback?: string;
    normalized?: UserFacingError;
  },
) => {
  const normalized =
    options?.normalized ??
    toUserFacingError(error, options?.fallback ? { fallback: options.fallback } : {});
  toast.custom((id) => (
    <div className="w-[min(420px,calc(100vw-2rem))]">
      <UserFacingErrorView
        error={normalized}
        variant="compact"
        action={
          <button
            type="button"
            className="sr-only"
            onClick={() => {
              toast.dismiss(id);
            }}
          >
            Dismiss
          </button>
        }
      />
    </div>
  ));
  return normalized;
};

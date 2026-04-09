import type { SVGProps } from "react";
import {
  getProviderColorClass,
  getProviderDescription,
  getProviderDisplayName,
  getProviderIcon as getSharedProviderIcon,
  isProviderUiProviderId,
  type ProviderUiIcon,
  type ProviderUiProviderId,
} from "@keppo/shared/providers-ui";

type IconProps = SVGProps<SVGSVGElement>;

function GoogleIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6Z"
        fill="#fff"
      />
      <path d="M2 6l10 7 10-7" stroke="#EA4335" strokeWidth="1.5" fill="none" />
      <path d="M2 6v12a2 2 0 0 0 2 2h1V8.5L2 6Z" fill="#4285F4" />
      <path d="M22 6v12a2 2 0 0 1-2 2h-1V8.5L22 6Z" fill="#34A853" />
      <path d="M5 20h14V8.5L12 13 5 8.5V20Z" fill="#F9F9F9" />
      <path d="M2 6l3 2.5V4H4a2 2 0 0 0-2 2Z" fill="#C5221F" />
      <path d="M22 6l-3 2.5V4h1a2 2 0 0 1 2 2Z" fill="#FBBC04" />
    </svg>
  );
}

function StripeIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect width="24" height="24" rx="4" fill="#635BFF" />
      <path
        d="M11.2 9.65c0-.68.56-.94 1.49-.94.97 0 2.2.3 3.17.82V6.66a8.5 8.5 0 0 0-3.17-.6c-2.6 0-4.32 1.35-4.32 3.62 0 3.53 4.86 2.97 4.86 4.49 0 .8-.7 1.06-1.67 1.06-1.44 0-2.84-.6-3.82-1.4v2.93a8.84 8.84 0 0 0 3.82.87c2.66 0 4.49-1.32 4.49-3.61-.01-3.81-4.85-3.13-4.85-4.47Z"
        fill="#fff"
      />
    </svg>
  );
}

function SlackIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M6.527 14.514a1.636 1.636 0 1 1-1.636-1.636h1.636v1.636Zm.818 0a1.636 1.636 0 1 1 3.273 0v4.09a1.636 1.636 0 1 1-3.273 0v-4.09Z"
        fill="#E01E5A"
      />
      <path
        d="M9.482 6.527a1.636 1.636 0 1 1 1.636-1.636v1.636H9.482Zm0 .818a1.636 1.636 0 0 1 0 3.273H5.39a1.636 1.636 0 1 1 0-3.273h4.091Z"
        fill="#36C5F0"
      />
      <path
        d="M17.468 9.482a1.636 1.636 0 1 1 1.636 1.636h-1.636V9.482Zm-.818 0a1.636 1.636 0 0 1-3.273 0V5.39a1.636 1.636 0 1 1 3.273 0v4.091Z"
        fill="#2EB67D"
      />
      <path
        d="M14.514 17.468a1.636 1.636 0 1 1-1.636 1.636v-1.636h1.636Zm0-.818a1.636 1.636 0 0 1 0-3.273h4.09a1.636 1.636 0 0 1 0 3.273h-4.09Z"
        fill="#ECB22E"
      />
    </svg>
  );
}

function GitHubIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10Z" />
    </svg>
  );
}

function NotionIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L18.08 2.18c-.42-.326-.98-.7-2.055-.607L3.01 2.7c-.467.047-.56.28-.374.466l1.823 1.042Zm.793 3.358v13.886c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.166V6.63c0-.606-.234-.933-.748-.886l-15.177.886c-.56.047-.747.327-.747.933Zm14.337.42c.094.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.934l-4.577-7.186v6.952l1.449.327s0 .84-1.168.84l-3.222.187c-.093-.187 0-.654.327-.747l.84-.22V8.744l-1.168-.093c-.094-.42.14-1.026.793-1.073l3.456-.234 4.764 7.28v-6.44l-1.215-.14c-.093-.514.28-.886.747-.933l3.222-.187Z" />
    </svg>
  );
}

function RedditIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="10" fill="#FF4500" />
      <path
        d="M18.5 12a1.5 1.5 0 0 0-2.566-1.06 7.348 7.348 0 0 0-3.934-1.2l.8-2.56 2.1.48a1 1 0 1 0 .12-.62l-2.4-.55a.36.36 0 0 0-.42.24l-.92 2.96a7.5 7.5 0 0 0-4.08 1.22A1.5 1.5 0 1 0 5.5 12a1.49 1.49 0 0 0 .22.78 2.88 2.88 0 0 0-.02.32c0 2.34 2.88 4.24 6.3 4.24s6.3-1.9 6.3-4.24c0-.1 0-.22-.02-.32A1.49 1.49 0 0 0 18.5 12ZM8.5 13a1 1 0 1 1 2 0 1 1 0 0 1-2 0Zm5.62 2.64c-.78.64-2.04.7-2.12.7-.08 0-1.34-.06-2.12-.7a.26.26 0 0 1 .36-.38c.5.4 1.24.52 1.76.52s1.26-.12 1.76-.52a.26.26 0 1 1 .36.38ZM15.4 13a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"
        fill="#fff"
      />
    </svg>
  );
}

function XIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

function LinkedInIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect width="24" height="24" rx="4" fill="#0A66C2" />
      <path
        d="M7.15 9.2H4.95v9.6h2.2V9.2Zm.14-2.97A1.29 1.29 0 1 0 4.71 6.2a1.29 1.29 0 0 0 2.58.03ZM19.1 13.02c0-2.95-1.57-4.32-3.67-4.32-1.69 0-2.45.93-2.87 1.58V9.2h-2.2c.03.72 0 9.6 0 9.6h2.2v-5.36c0-.29.02-.57.11-.78.23-.57.75-1.16 1.63-1.16 1.15 0 1.61.87 1.61 2.15v5.15h2.2v-5.78Z"
        fill="#fff"
      />
    </svg>
  );
}

function CustomIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />
    </svg>
  );
}

const ICON_COMPONENTS = {
  google: GoogleIcon,
  stripe: StripeIcon,
  slack: SlackIcon,
  github: GitHubIcon,
  notion: NotionIcon,
  reddit: RedditIcon,
  x: XIcon,
  linkedin: LinkedInIcon,
  custom: CustomIcon,
} as const satisfies Record<ProviderUiIcon, (props: IconProps) => React.ReactNode>;

export type ProviderKey = ProviderUiProviderId;

export interface ProviderMeta {
  key: ProviderKey;
  label: string;
  description: string;
  icon: (props: IconProps) => React.ReactNode;
  color: string;
}

export interface ResolvedProviderMeta {
  key: string;
  label: string;
  description: string;
  icon: (props: IconProps) => React.ReactNode;
  color: string;
}

const toTitleCase = (value: string): string =>
  value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

export const isProviderKey = (provider: string): provider is ProviderKey => {
  return isProviderUiProviderId(provider);
};

const toResolvedMeta = (provider: ProviderUiProviderId): ResolvedProviderMeta => {
  const iconKey = getSharedProviderIcon(provider);
  const icon = ICON_COMPONENTS[iconKey] ?? CustomIcon;
  return {
    key: provider,
    label: getProviderDisplayName(provider),
    description: getProviderDescription(provider),
    icon,
    color: getProviderColorClass(provider),
  };
};

export const getProviderMeta = (provider: string): ResolvedProviderMeta => {
  if (isProviderUiProviderId(provider)) {
    return toResolvedMeta(provider);
  }

  return {
    key: provider,
    label: toTitleCase(provider),
    description: "Provider metadata is available but no dashboard skin is defined yet.",
    icon: CustomIcon,
    color: "bg-blue-50 dark:bg-blue-950/30",
  };
};

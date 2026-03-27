import { useEffect, useRef } from "react";

const DEFAULT_FAVICON_PATH = "/keppo-logo.png";

const buildBadgedFavicon = (count: number): Promise<string> => {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      resolve("");
      return;
    }

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, 64, 64);

      ctx.beginPath();
      ctx.fillStyle = "#ef4444";
      ctx.arc(48, 16, 14, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = count > 9 ? "9+" : String(count);
      ctx.fillText(label, 48, 16);

      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve("");
    img.src = "/keppo-logo.png";
  });
};

export const useFaviconBadge = (count: number) => {
  const originalIconHrefRef = useRef<string | null>(null);
  const originalTitleRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    if (originalTitleRef.current === null) {
      originalTitleRef.current = document.title;
    }

    let iconLink = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
    if (!iconLink) {
      iconLink = document.createElement("link");
      iconLink.rel = "icon";
      document.head.appendChild(iconLink);
    }

    if (originalIconHrefRef.current === null) {
      const currentHref = iconLink.getAttribute("href");
      originalIconHrefRef.current = new URL(
        currentHref && currentHref.trim().length > 0 ? currentHref : DEFAULT_FAVICON_PATH,
        window.location.href,
      ).href;
    }

    if (count > 0) {
      const currentIconLink = iconLink;
      void buildBadgedFavicon(count).then((nextIconHref) => {
        if (nextIconHref) {
          currentIconLink.href = nextIconHref;
        }
      });
      const prefix = count > 99 ? "99+" : String(count);
      const baseTitle = originalTitleRef.current ?? "Keppo Dashboard";
      document.title = `(${prefix}) ${baseTitle.replace(/^\(\d+\+?\)\s*/, "")}`;
      return;
    }

    iconLink.href =
      originalIconHrefRef.current ?? new URL(DEFAULT_FAVICON_PATH, window.location.href).href;
    if (originalTitleRef.current) {
      document.title = originalTitleRef.current;
    }
  }, [count]);
};

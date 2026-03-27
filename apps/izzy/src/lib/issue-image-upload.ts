import { getServerEnv } from "./env";
import type { UploadedImage } from "./contracts";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const safeSegment = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

export const validateImageFile = (file: File): void => {
  if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
    throw new Error("invalid_image_type");
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error("invalid_image_size");
  }
};

export const uploadImageFile = async (file: File): Promise<UploadedImage> => {
  validateImageFile(file);
  const env = getServerEnv();
  if (!env.IZZY_BLOB_READ_WRITE_TOKEN) {
    throw new Error("missing_blob_token");
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const pathname = `${env.IZZY_BLOB_BASE_PATH}/${Date.now()}-${safeSegment(file.name || "issue-image")}.${safeSegment(extension)}`;
  const uploadUrl = `https://vercel.com/api/blob?pathname=${encodeURIComponent(pathname)}`;
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env.IZZY_BLOB_READ_WRITE_TOKEN}`,
      "x-api-version": "12",
      "x-access": "public",
      "x-add-random-suffix": "0",
      "x-allow-overwrite": "1",
      "x-content-type": file.type,
    },
    body: Buffer.from(await file.arrayBuffer()),
  });
  if (!response.ok) {
    throw new Error(`blob_upload_${response.status}`);
  }
  const payload = (await response.json()) as { url?: string };
  if (!payload.url) {
    throw new Error("missing_blob_url");
  }
  return {
    url: payload.url,
    pathname,
    contentType: file.type,
    sizeBytes: file.size,
    alt: null,
  };
};

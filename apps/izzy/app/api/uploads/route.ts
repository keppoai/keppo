import { NextResponse } from "next/server";
import { uploadImageFile } from "@/lib/issue-image-upload";
import { requireIzzySession } from "@/lib/session";
import { errorResponse, unknownErrorResponse } from "@/lib/user-facing-error";

export async function POST(request: Request) {
  try {
    await requireIzzySession();
    const formData = await request.formData();
    const fileValue = formData.get("file");
    if (!(fileValue instanceof File)) {
      return errorResponse(400, {
        code: "missing_file",
        title: "Select an image first",
        summary: "Izzy did not receive an image file to upload.",
        nextSteps: ["Choose a PNG, JPEG, WEBP, or GIF file.", "Try the upload again."],
      });
    }
    const image = await uploadImageFile(fileValue);
    return NextResponse.json({
      ok: true,
      image,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "unauthorized_session") {
      return errorResponse(401, {
        code: "unauthorized",
        title: "Sign in required",
        summary: "You need an approved GitHub session to upload images.",
        nextSteps: ["Sign in with GitHub.", "Use an allowlisted GitHub account."],
      });
    }
    if (error instanceof Error && error.message === "invalid_image_type") {
      return errorResponse(400, {
        code: "invalid_image_type",
        title: "That file type is not supported",
        summary: "Use a PNG, JPEG, WEBP, or GIF image.",
        nextSteps: ["Choose a supported image format.", "Try the upload again."],
      });
    }
    if (error instanceof Error && error.message === "invalid_image_size") {
      return errorResponse(400, {
        code: "invalid_image_size",
        title: "That image is too large",
        summary: "Izzy only accepts images up to 8 MB.",
        nextSteps: ["Reduce the image size.", "Try the upload again."],
      });
    }
    return unknownErrorResponse(error, {
      action: "upload the image",
    });
  }
}

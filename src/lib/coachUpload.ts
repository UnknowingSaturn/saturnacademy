// Client-side helpers for uploading chart screenshots to the coach-uploads bucket.
// The bucket is private; RLS scopes writes/reads to `${user_id}/*`.
import { supabase } from "@/integrations/supabase/client";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

export interface CoachUploadResult {
  storage_path: string;
  preview_url: string; // objectURL for optimistic preview
}

export function validateImage(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) return "Only PNG, JPEG, or WebP images are supported.";
  if (file.size > MAX_BYTES) return "Image must be under 5 MB.";
  return null;
}

/** Downscale to max 2000px on the longest side, then upload. */
export async function uploadCoachImage(
  file: File,
  threadId: string,
): Promise<CoachUploadResult> {
  const err = validateImage(file);
  if (err) throw new Error(err);
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const downscaled = await downscale(file, 2000);
  const ext = extFromMime(downscaled.type) ?? "jpg";
  const filename = `${crypto.randomUUID()}.${ext}`;
  const path = `${userId}/${threadId}/${filename}`;

  const { error } = await supabase.storage
    .from("coach-uploads")
    .upload(path, downscaled, { contentType: downscaled.type, upsert: false });
  if (error) throw new Error(error.message);

  return { storage_path: path, preview_url: URL.createObjectURL(downscaled) };
}

function extFromMime(mime: string): string | null {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return null;
}

async function downscale(file: File, maxSide: number): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  if (scale >= 1) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
  return await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b ?? file), mime, 0.9),
  );
}

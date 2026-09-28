import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const uploadDir = path.resolve(process.env["UPLOAD_DIR"] ?? "uploads");
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf",
  "text/plain", "application/zip", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
export type IncomingAttachment = { name?: string; mimeType?: string; size?: number; data?: string };
export type StoredAttachment = { name: string; mimeType: string; size: number; url: string };

export async function saveAttachments(input: IncomingAttachment[] | undefined, route = "conversations"): Promise<StoredAttachment[]> {
  if (!input?.length) return [];
  if (input.length > 5) throw new Error("A maximum of 5 attachments is allowed");
  const prepared = input.map((attachment) => {
    const mimeType = attachment.mimeType ?? "";
    const encoded = attachment.data?.replace(/^data:[^;]+;base64,/, "");
    if (!attachment.name || !encoded || !ALLOWED_MIME.has(mimeType) ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
      throw new Error("Unsupported attachment");
    }
    const bytes = Buffer.from(encoded, "base64");
    if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES ||
      (attachment.size !== undefined && attachment.size !== bytes.length)) {
      throw new Error("Attachment must be no larger than 8 MB");
    }
    return { attachment, mimeType, bytes };
  });
  const total = prepared.reduce((sum, { bytes }) => sum + bytes.length, 0);
  if (total > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error("Attachments exceed the 10 MB total limit");
  await mkdir(uploadDir, { recursive: true });
  const saved: StoredAttachment[] = [];
  for (const { attachment, mimeType, bytes } of prepared) {
    const filename = `${randomUUID()}${path.extname(attachment.name!).slice(0, 10)}`;
    await writeFile(path.join(uploadDir, filename), bytes, { flag: "wx" });
    saved.push({ name: attachment.name!.slice(0, 255), mimeType, size: bytes.length, url: `/${route}/attachments/${filename}` });
  }
  return saved;
}

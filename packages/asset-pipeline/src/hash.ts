import { createHash } from "node:crypto";

/** Compute SHA-256 hash of a buffer */
export function computeContentHash(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

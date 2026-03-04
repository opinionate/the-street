import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { computeContentHash } from "./hash.js";

const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
});

const BUCKET = process.env.AWS_S3_BUCKET || "the-street-assets";
const CDN_BASE = process.env.CDN_BASE_URL || `https://${BUCKET}.s3.amazonaws.com`;

export interface UploadResult {
  contentHash: string;
  s3Key: string;
  cdnUrl: string;
  fileSizeBytes: number;
  isDuplicate: boolean;
}

/** Check if an asset already exists in S3 */
async function assetExists(contentHash: string): Promise<boolean> {
  try {
    await s3.send(
      new HeadObjectCommand({
        Bucket: BUCKET,
        Key: `assets/${contentHash}.glb`,
      })
    );
    return true;
  } catch {
    return false;
  }
}

/** Upload a glTF binary to S3 with content-addressed key */
export async function uploadAsset(data: Buffer): Promise<UploadResult> {
  const contentHash = computeContentHash(data);
  const s3Key = `assets/${contentHash}.glb`;

  // Dedup check
  const exists = await assetExists(contentHash);
  if (exists) {
    return {
      contentHash,
      s3Key,
      cdnUrl: `${CDN_BASE}/${s3Key}`,
      fileSizeBytes: data.length,
      isDuplicate: true,
    };
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      Body: data,
      ContentType: "model/gltf-binary",
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  return {
    contentHash,
    s3Key,
    cdnUrl: `${CDN_BASE}/${s3Key}`,
    fileSizeBytes: data.length,
    isDuplicate: false,
  };
}

/** Get CDN URL for an asset by content hash */
export function getAssetUrl(contentHash: string): string {
  return `${CDN_BASE}/assets/${contentHash}.glb`;
}

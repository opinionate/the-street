import { createSign } from "node:crypto";

/** Sign a content hash with an Ed25519 private key (PEM format) */
export function signContentHash(
  contentHash: string,
  privateKeyPem: string
): string {
  const sign = createSign("SHA256");
  sign.update(contentHash);
  sign.end();
  return sign.sign(privateKeyPem, "base64");
}

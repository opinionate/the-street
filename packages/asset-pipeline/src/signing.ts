import { createSign, createVerify } from "node:crypto";

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

/** Verify a signature against a content hash and public key */
export function verifySignature(
  contentHash: string,
  signature: string,
  publicKeyPem: string
): boolean {
  const verify = createVerify("SHA256");
  verify.update(contentHash);
  verify.end();
  return verify.verify(publicKeyPem, signature, "base64");
}

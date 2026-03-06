// Environment configuration

export interface Env {
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_S3_BUCKET: string;
  AWS_REGION: string;
  ANTHROPIC_API_KEY: string;
  MASTER_ENCRYPTION_KEY: string;
  COLYSEUS_PORT: number;
  API_PORT: number;
  CDN_BASE_URL: string;
}

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export function loadEnv(): Env {
  return {
    CLERK_SECRET_KEY: requireEnv("CLERK_SECRET_KEY"),
    CLERK_PUBLISHABLE_KEY: requireEnv("CLERK_PUBLISHABLE_KEY"),
    DATABASE_URL: requireEnv("DATABASE_URL"),
    REDIS_URL: requireEnv("REDIS_URL"),
    AWS_ACCESS_KEY_ID: requireEnv("AWS_ACCESS_KEY_ID"),
    AWS_SECRET_ACCESS_KEY: requireEnv("AWS_SECRET_ACCESS_KEY"),
    AWS_S3_BUCKET: optionalEnv("AWS_S3_BUCKET", "the-street-assets"),
    AWS_REGION: optionalEnv("AWS_REGION", "us-east-1"),
    ANTHROPIC_API_KEY: requireEnv("ANTHROPIC_API_KEY"),
    MASTER_ENCRYPTION_KEY: requireEnv("MASTER_ENCRYPTION_KEY"),
    COLYSEUS_PORT: parseInt(optionalEnv("COLYSEUS_PORT", "2567"), 10),
    API_PORT: parseInt(optionalEnv("API_PORT", "3000"), 10),
    CDN_BASE_URL: optionalEnv("CDN_BASE_URL", "https://cdn.thestreet.world"),
  };
}

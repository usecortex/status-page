import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import type { S3ClientConfig } from "@aws-sdk/client-s3";
import type { StatusSnapshot } from "@/types/status";

const STATUS_FILE_KEY = "status.json";

// ---------------------------------------------------------------------------
// Shared S3 helpers — also used by health-state.ts
// ---------------------------------------------------------------------------

let _s3Client: S3Client | null = null;

/**
 * Returns a lazily-initialised S3Client singleton.
 * Credentials are only injected when the corresponding env vars are present,
 * allowing the AWS SDK to fall back to instance-profile / IRSA credentials
 * in environments that provide them automatically.
 */
export function getS3Client(): S3Client {
  if (!_s3Client) {
    const config: S3ClientConfig = {
      region: process.env.S3_REGION || "us-east-1",
    };
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      };
    }
    _s3Client = new S3Client(config);
  }
  return _s3Client;
}

export function getBucketName(): string {
  return process.env.S3_BUCKET_NAME || "hydradb-status-page-data";
}

/**
 * Returns the public URL for the status.json file in S3.
 * Used by the frontend (ISR) to fetch status data without AWS credentials.
 */
export function getStatusDataUrl(): string {
  // Allow override for local development / testing
  if (process.env.STATUS_DATA_URL) {
    return process.env.STATUS_DATA_URL;
  }
  const bucket = getBucketName();
  const region = process.env.S3_REGION || "us-east-1";
  return `https://${bucket}.s3.${region}.amazonaws.com/${STATUS_FILE_KEY}`;
}

/**
 * Writes the status snapshot to S3.
 * Called by the cron job after computing uptime data.
 */
export async function writeStatusData(data: StatusSnapshot): Promise<void> {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: STATUS_FILE_KEY,
    Body: JSON.stringify(data),
    ContentType: "application/json",
    CacheControl: "public, max-age=60, stale-while-revalidate=30",
  });
  await client.send(command);
}

/**
 * Reads the current status snapshot from S3.
 * Called by the cron job to merge with existing historical data.
 * Returns null if the file doesn't exist (first run).
 */
export async function readStatusData(): Promise<StatusSnapshot | null> {
  const client = getS3Client();
  try {
    const command = new GetObjectCommand({
      Bucket: getBucketName(),
      Key: STATUS_FILE_KEY,
    });
    const response = await client.send(command);
    const body = await response.Body?.transformToString();
    if (!body) return null;
    return JSON.parse(body) as StatusSnapshot;
  } catch (err: unknown) {
    // NoSuchKey means first run -- return null
    if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "NoSuchKey") {
      return null;
    }
    throw err;
  }
}

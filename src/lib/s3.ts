import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { StatusSnapshot } from "@/types/status";

const STATUS_FILE_KEY = "status.json";

function getS3Client(): S3Client {
  return new S3Client({
    region: process.env.S3_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    },
  });
}

function getBucketName(): string {
  return process.env.S3_BUCKET_NAME || "hydradb-status-data";
}

/**
 * Returns the public URL for the status.json file in S3.
 * Used by the frontend (ISR) to fetch status data without AWS credentials.
 */
export function getStatusDataUrl(): string {
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

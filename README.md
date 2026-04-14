# HydraDB Status Page

Public-facing status page for HydraDB, deployed at `status.hydradb.com`.

## Architecture

```
incident.io Widget API
        |
        v
  +---------------+     writes JSON      +----------+
  |  Cron Job     | ------------------->  |  AWS S3  |
  |  (Vercel)     |   every 5 min        |  (public)|
  +---------------+                       +----------+
                                               |
                                         reads JSON (ISR)
                                               |
                                               v
                                    +---------------------+
                                    | status.hydradb.com  |
                                    | Next.js on Vercel   |
                                    | ISR (60s revalidate)|
                                    +---------------------+
```

**Key design principle**: The frontend makes zero runtime API calls to incident.io. All data is pre-computed by the cron job and stored as a static JSON file in S3. If `app.hydradb.com` goes down, `status.hydradb.com` is completely unaffected.

## Features

- **6 component groups**: Query & Retrieval, Knowledge Ingestion, Memories, Dashboard, Documentation, Website
- **90-day uptime history** with 30/60/90 day rolling metrics
- **Real-time incident display** with status badges and update timeline
- **Scheduled maintenance** windows
- **Dark theme** matching HydraDB brand

## Setup

### Prerequisites

- Node.js 18+
- AWS S3 bucket with public read access
- Vercel account
- (Optional) incident.io account with Widget API

### 1. S3 Bucket

Create an S3 bucket and add a public read policy for the status data:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadStatusJson",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/status.json"
    }
  ]
}
```

### 2. Environment Variables

Copy `.env.example` and fill in:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|----------|----------|-------------|
| `AWS_ACCESS_KEY_ID` | Yes | AWS credentials with S3 read/write access |
| `AWS_SECRET_ACCESS_KEY` | Yes | AWS secret key |
| `AWS_REGION` | Yes | S3 bucket region (e.g., `us-east-1`) |
| `S3_BUCKET_NAME` | Yes | S3 bucket name |
| `CRON_SECRET` | Yes | Secret for authenticating Vercel cron requests |
| `INCIDENT_IO_WIDGET_URL` | No | incident.io Widget API URL (omit to use defaults) |

### 3. Vercel Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

Set all environment variables in the Vercel dashboard under **Settings > Environment Variables**.

The cron job is configured in `vercel.json` to run every 5 minutes at `/api/cron`.

### 4. DNS

Add a CNAME record pointing `status.hydradb.com` to your Vercel deployment URL, then add the custom domain in Vercel's dashboard.

## Development

```bash
npm install
npm run dev
```

Without S3 credentials, the page renders in an unconfigured fallback state showing default component groups.

### Running Tests

```bash
npx jest --verbose
```

## Tech Stack

- **Next.js 14** (App Router, ISR)
- **TypeScript** (strict mode)
- **AWS S3** (static data storage)
- **Tailwind CSS** (utility classes + CSS variables for theming)
- **Jest** (unit testing)

import { getStatusDataUrl } from "@/lib/s3";
import { StatusSnapshot } from "@/types/status";
import StatusPage from "@/components/StatusPage";

// Revalidate every 60 seconds
export const revalidate = 60;

export default async function Page() {
  let data: StatusSnapshot | null = null;

  try {
    const url = getStatusDataUrl();
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      data = await res.json();
    }
  } catch {
    // S3 fetch failed -- render with null data (unconfigured state)
  }

  return <StatusPage data={data} />;
}

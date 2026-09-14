import { getCurrentUser } from "@/lib/auth/session";
import { getServices } from "@/lib/services";
import type { WaitlistStatus } from "@/types/database";

export const dynamic = "force-dynamic";

const STATUSES: WaitlistStatus[] = ["pending", "invited", "joined", "declined"];

/** Quote a CSV cell; neutralize spreadsheet formulas. */
function cell(value: string | null | undefined): string {
  let text = value ?? "";
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** GET /admin/waitlist/export?status=pending — CSV download for admins. */
export async function GET(request: Request): Promise<Response> {
  const current = await getCurrentUser();
  if (!current?.isAdmin) return new Response("Not found", { status: 404 });

  const status = STATUSES.find((s) => s === new URL(request.url).searchParams.get("status"));
  const entries = await getServices().repositories.waitlist.list({ status, limit: 10_000 });
  const header = ["email", "name", "channel_url", "niche", "use_case", "source", "status", "signed_up", "invited_at", "joined_at"];
  const lines = entries.map((e) =>
    [e.email, e.name, e.channel_url, e.niche, e.use_case, e.source, e.status, e.created_at, e.invited_at, e.joined_at].map(cell).join(","),
  );
  const csv = [header.join(","), ...lines].join("\r\n");
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="waitlist-${status ?? "all"}-${day}.csv"`,
      "cache-control": "no-store",
    },
  });
}
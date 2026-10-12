import Link from "next/link";
import { getJson, formatDate } from "@/lib/api";
import type { Call } from "@/lib/api";
import { EmptyState } from "@/components/empty-state";
import { ScoreBadge } from "@/components/score-badge";

export const dynamic = "force-dynamic";

export default async function CallsPage() {
  const calls = await getJson<Call[]>("/api/calls");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Call History</h1>
        <p className="text-sm text-zinc-500">{calls.length} total calls.</p>
      </header>

      {calls.length === 0 ? (
        <EmptyState
          title="No calls recorded"
          description="Calls will appear here after the AI answers."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Caller
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Intent
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Score
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Date
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {calls.map((call) => (
                <tr key={call.id} className="transition-colors hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/calls/${call.id}`}
                      className="rounded font-medium text-zinc-900 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                    >
                      {call.from_number ?? "Unknown"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">
                    {call.intent ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <ScoreBadge score={call.lead_score} />
                  </td>
                  <td className="px-4 py-3 tabular-nums text-zinc-600">
                    {formatDate(call.started_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

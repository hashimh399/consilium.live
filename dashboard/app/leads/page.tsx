import Link from "next/link";
import { getJson, formatDate } from "@/lib/api";
import type { Lead } from "@/lib/api";
import { EmptyState } from "@/components/empty-state";
import { ScoreBadge } from "@/components/score-badge";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const leads = await getJson<Lead[]>("/api/leads");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
        <p className="text-sm text-zinc-500">{leads.length} total leads.</p>
      </header>

      {leads.length === 0 ? (
        <EmptyState
          title="No leads yet"
          description="Qualified leads will appear here."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Name
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Phone
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Model
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Budget
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Timeline
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Score
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {leads.map((lead) => (
                <tr key={lead.id} className="transition-colors hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/calls/${lead.call_id}`}
                      className="rounded font-medium text-zinc-900 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                    >
                      {lead.name ?? "Unknown"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{lead.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-zinc-600">
                    {lead.preferred_model ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{lead.budget ?? "—"}</td>
                  <td className="px-4 py-3 text-zinc-600">{lead.timeline ?? "—"}</td>
                  <td className="px-4 py-3">
                    <ScoreBadge score={lead.score} />
                  </td>
                  <td className="px-4 py-3 tabular-nums text-zinc-600">
                    {formatDate(lead.created_at)}
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

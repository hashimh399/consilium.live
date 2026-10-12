import Link from "next/link";
import { getJson, formatDate } from "@/lib/api";
import type { Call, Lead, Stats } from "@/lib/api";
import { EmptyState } from "@/components/empty-state";
import { ScoreBadge } from "@/components/score-badge";
import { StatCard } from "@/components/stat-card";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const stats = await getJson<Stats>("/api/stats");
  const calls = await getJson<Call[]>("/api/calls");
  const leads = await getJson<Lead[]>("/api/leads");

  const recentCalls = calls.slice(0, 5);
  const hotLeads = leads.filter((l) => l.score === "Hot").slice(0, 5);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-zinc-500">
          Live snapshot of dealership calls and leads.
        </p>
      </header>

      <section
        aria-label="Key metrics"
        className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6"
      >
        <StatCard label="Total Calls" value={stats.total_calls} />
        <StatCard label="AI Handled" value={stats.ai_handled_calls} />
        <StatCard label="Leads" value={stats.leads} />
        <StatCard label="Hot Leads" value={stats.hot_leads} accent />
        <StatCard label="Test Drives" value={stats.test_drives} />
        <StatCard label="Service" value={stats.service_appointments} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="recent-calls">
          <h2 id="recent-calls" className="mb-3 text-base font-semibold">
            Recent Calls
          </h2>
          {recentCalls.length === 0 ? (
            <EmptyState
              title="No calls yet"
              description="Incoming calls will appear here."
            />
          ) : (
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
              {recentCalls.map((call) => (
                <li key={call.id}>
                  <Link
                    href={`/calls/${call.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {call.from_number ?? "Unknown"}
                      </p>
                      <p className="truncate text-xs text-zinc-500">
                        {call.intent ?? "No intent"} · {formatDate(call.started_at)}
                      </p>
                    </div>
                    <ScoreBadge score={call.lead_score} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="hot-leads">
          <h2 id="hot-leads" className="mb-3 text-base font-semibold">
            Hot Leads
          </h2>
          {hotLeads.length === 0 ? (
            <EmptyState
              title="No hot leads yet"
              description="Leads scored Hot will appear here."
            />
          ) : (
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
              {hotLeads.map((lead) => (
                <li
                  key={lead.id}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {lead.name ?? "Unknown"}
                    </p>
                    <p className="truncate text-xs text-zinc-500">
                      {lead.preferred_model ?? "No model"} ·{" "}
                      {lead.phone ?? "No phone"}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-zinc-400">
                    {lead.timeline ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

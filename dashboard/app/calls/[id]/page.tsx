import Link from "next/link";
import { notFound } from "next/navigation";
import { HttpError, getJson, formatDate } from "@/lib/api";
import type { CallDetail } from "@/lib/api";
import { EmptyState } from "@/components/empty-state";
import { ScoreBadge } from "@/components/score-badge";

export const dynamic = "force-dynamic";

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let call: CallDetail;
  try {
    call = await getJson<CallDetail>(`/api/calls/${id}`);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }

  const lead = call.leads[0];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <Link
          href="/calls"
          className="text-sm text-zinc-500 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded"
        >
          ← Back to calls
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {call.from_number ?? "Unknown caller"}
          </h1>
          <ScoreBadge score={call.lead_score} />
          {call.handed_off ? (
            <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200">
              Transferred to human
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          <span translate="no">{call.call_sid}</span> · {formatDate(call.started_at)}
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <section
          aria-labelledby="summary-heading"
          className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
        >
          <h2
            id="summary-heading"
            className="text-sm font-semibold uppercase tracking-wide text-zinc-500"
          >
            AI Summary
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-700">
            {call.summary ?? "No summary available."}
          </p>
          <div className="mt-4 border-t border-zinc-100 pt-4">
            <p className="text-sm text-zinc-500">Intent</p>
            <p className="text-sm font-medium text-zinc-900">
              {call.intent ?? "—"}
            </p>
          </div>
        </section>

        <section
          aria-labelledby="next-heading"
          className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
        >
          <h2
            id="next-heading"
            className="text-sm font-semibold uppercase tracking-wide text-zinc-500"
          >
            Recommended Next Action
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-700">
            {call.next_action ?? "No action recommended."}
          </p>
        </section>
      </div>

      {lead ? (
        <section
          aria-labelledby="lead-heading"
          className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <h2
              id="lead-heading"
              className="text-sm font-semibold uppercase tracking-wide text-zinc-500"
            >
              Lead Details
            </h2>
            <ScoreBadge score={lead.score} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-zinc-500">Name</dt>
              <dd className="font-medium">{lead.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Phone</dt>
              <dd className="font-medium">{lead.phone ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Budget</dt>
              <dd className="font-medium">{lead.budget ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Preferred Model</dt>
              <dd className="font-medium">{lead.preferred_model ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Timeline</dt>
              <dd className="font-medium">{lead.timeline ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Recommended</dt>
              <dd className="font-medium">{lead.recommended_model ?? "—"}</dd>
            </div>
          </dl>
          {lead.score_reasons ? (
            <p className="mt-4 text-sm text-zinc-600">
              <span className="font-medium text-zinc-500">Why this score: </span>
              {lead.score_reasons}
            </p>
          ) : null}
        </section>
      ) : null}

      {call.test_drives.length > 0 ? (
        <section
          aria-labelledby="td-heading"
          className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
        >
          <h2
            id="td-heading"
            className="text-sm font-semibold uppercase tracking-wide text-zinc-500"
          >
            Test Drive
          </h2>
          <ul className="mt-3 space-y-2">
            {call.test_drives.map((td) => (
              <li key={td.id} className="text-sm text-zinc-700">
                {td.model ?? "Model"} · {td.preferred_date ?? "—"} at{" "}
                {td.preferred_time ?? "—"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {call.service_appointments.length > 0 ? (
        <section
          aria-labelledby="svc-heading"
          className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
        >
          <h2
            id="svc-heading"
            className="text-sm font-semibold uppercase tracking-wide text-zinc-500"
          >
            Service Appointment
          </h2>
          <ul className="mt-3 space-y-2">
            {call.service_appointments.map((s) => (
              <li key={s.id} className="text-sm text-zinc-700">
                {s.vehicle_model ?? "Vehicle"} · reg {s.registration_number ?? "—"} ·{" "}
                {s.service_requirement ?? "—"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="transcript-heading">
        <h2
          id="transcript-heading"
          className="text-base font-semibold"
        >
          Transcript
        </h2>
        {call.messages.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No transcript" description="Messages will appear here." />
          </div>
        ) : (
          <ol className="mt-3 space-y-3">
            {call.messages.map((m) => (
              <li
                key={m.id}
                className={`flex flex-col ${
                  m.role === "assistant" ? "items-start" : "items-end"
                }`}
              >
                <span className="mb-1 text-xs uppercase tracking-wide text-zinc-400">
                  {m.role === "assistant" ? "AI Assistant" : "Customer"}
                </span>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-6 ${
                    m.role === "assistant"
                      ? "bg-white text-zinc-800 ring-1 ring-zinc-200"
                      : "bg-zinc-900 text-zinc-100"
                  }`}
                >
                  {m.content}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

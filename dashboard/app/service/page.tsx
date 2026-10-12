import Link from "next/link";
import { getJson, formatDate } from "@/lib/api";
import type { ServiceAppointment } from "@/lib/api";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

export default async function ServicePage() {
  const items = await getJson<ServiceAppointment[]>("/api/service-appointments");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Service Appointments
        </h1>
        <p className="text-sm text-zinc-500">{items.length} appointments.</p>
      </header>

      {items.length === 0 ? (
        <EmptyState
          title="No service appointments"
          description="Service bookings will appear here."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Customer
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Vehicle
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Registration
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Requirement
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Preferred Time
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {items.map((s) => (
                <tr key={s.id} className="transition-colors hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/calls/${s.call_id}`}
                      className="rounded font-medium text-zinc-900 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                    >
                      {s.customer_name ?? "Unknown"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">
                    {s.vehicle_model ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">
                    <span translate="no">{s.registration_number ?? "—"}</span>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">
                    {s.service_requirement ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">
                    {s.preferred_time ?? "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-zinc-600">
                    {formatDate(s.created_at)}
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

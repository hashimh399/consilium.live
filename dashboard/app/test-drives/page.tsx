import Link from "next/link";
import { getJson } from "@/lib/api";
import type { TestDrive } from "@/lib/api";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

export default async function TestDrivesPage() {
  const items = await getJson<TestDrive[]>("/api/test-drives");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Test Drives</h1>
        <p className="text-sm text-zinc-500">{items.length} requests.</p>
      </header>

      {items.length === 0 ? (
        <EmptyState
          title="No test drive requests"
          description="Test drive bookings will appear here."
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
                  Model
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Date
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Time
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {items.map((td) => (
                <tr key={td.id} className="transition-colors hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/calls/${td.call_id}`}
                      className="rounded font-medium text-zinc-900 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                    >
                      {td.name ?? "Unknown"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{td.model ?? "—"}</td>
                  <td className="px-4 py-3 text-zinc-600">
                    {td.preferred_date ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">
                    {td.preferred_time ?? "—"}
                  </td>
                  <td className="px-4 py-3 capitalize text-zinc-600">
                    {td.status}
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

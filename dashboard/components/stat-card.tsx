export function StatCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-zinc-500">{label}</p>
      <p
        className={`mt-1 text-3xl font-semibold tabular-nums ${
          accent ? "text-red-600" : "text-zinc-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

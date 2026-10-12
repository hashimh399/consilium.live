const styles: Record<string, string> = {
  Hot: "bg-red-50 text-red-700 ring-red-200",
  Warm: "bg-amber-50 text-amber-700 ring-amber-200",
  Cold: "bg-sky-50 text-sky-700 ring-sky-200",
};

export function ScoreBadge({ score }: { score: string | null }) {
  if (!score) {
    return <span className="text-zinc-400">—</span>;
  }
  const cls = styles[score] ?? "bg-zinc-100 text-zinc-600 ring-zinc-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}
    >
      {score}
    </span>
  );
}

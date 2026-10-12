export default function Loading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <p
        role="status"
        aria-live="polite"
        className="text-sm text-zinc-500"
      >
        Loading…
      </p>
    </div>
  );
}

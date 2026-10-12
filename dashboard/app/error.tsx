"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
      <h1 className="text-lg font-semibold text-zinc-900">
        Something went wrong
      </h1>
      <p className="mt-2 text-sm text-zinc-600">
        {error.message || "An unexpected error occurred."}
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        Make sure the backend is running on port 8000.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
      >
        Try again
      </button>
    </div>
  );
}

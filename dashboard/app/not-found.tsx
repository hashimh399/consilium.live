import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
      <h1 className="text-lg font-semibold text-zinc-900">Not found</h1>
      <p className="mt-2 text-sm text-zinc-600">
        The page you are looking for does not exist.
      </p>
      <Link
        href="/"
        className="mt-4 inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
      >
        Back to overview
      </Link>
    </div>
  );
}

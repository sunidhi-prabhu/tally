export function SetupRequired({ problems }: { problems: readonly string[] }) {
  return (
    <main className="flex flex-1 flex-col justify-center gap-4 py-10">
      <h1 className="text-2xl font-semibold">
        Tally isn&apos;t configured yet
      </h1>
      <p className="text-muted">
        This build has no network to talk to. Nothing is shown rather than
        made-up data.
      </p>
      <ul className="list-disc space-y-1 rounded-2xl border border-border bg-surface p-4 pl-8 text-sm">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p className="text-sm text-muted">
        For the local demo, set{" "}
        <code>NEXT_PUBLIC_TALLY_NETWORK=local-demo</code> and follow
        apps/web/README.md.
      </p>
    </main>
  );
}

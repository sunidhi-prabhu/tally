import { Suspense, type ComponentType } from "react";
import { LoadingList, EmptyState } from "./ui";

/**
 * Awaits dynamic `params` inside <Suspense> (required by Cache Components) and validates the
 * group ID before rendering a client screen.
 */
export function GroupRoute({
  params,
  Screen,
}: {
  params: Promise<{ groupId: string }>;
  Screen: ComponentType<{ groupId: string }>;
}) {
  return (
    <Suspense fallback={<LoadingList label="Loading group" />}>
      <Resolved params={params} Screen={Screen} />
    </Suspense>
  );
}

async function Resolved({
  params,
  Screen,
}: {
  params: Promise<{ groupId: string }>;
  Screen: ComponentType<{ groupId: string }>;
}) {
  const { groupId } = await params;
  if (!/^[1-9]\d{0,30}$/.test(groupId)) {
    return <EmptyState title="That isn't a valid group link" />;
  }
  return <Screen groupId={groupId} />;
}

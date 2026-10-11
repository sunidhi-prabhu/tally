import { useEffect, useState } from "react";

/**
 * Next.js (with Cache Components) keeps recently visited pages alive in a hidden React
 * <Activity> and restores them as they were, so a finished form would come back locked. Effects
 * clean up when a page is hidden: bump a counter then, and use it as the form's `key` so the next
 * visit starts with a fresh, empty form.
 */
export function useFreshOnReturn(): number {
  const [visit, setVisit] = useState(0);
  useEffect(() => () => setVisit((v) => v + 1), []);
  return visit;
}

import { useEffect, useRef, useState } from "react";
import { cloudConfigured } from "../account/supabase";
import { listAcademicCourses, type AcademicCourse } from "./client";
import { listPublicCourses, publicCatalogCourse } from "./publicCatalog";

interface CatalogPage {
  scope: string;
  courses: AcademicCourse[];
  loading: boolean;
  more: boolean;
  error: string;
}
const empty = (scope: string, loading = false): CatalogPage => ({ scope, courses: [], loading, more: false, error: "" });

/** A signed-in account reads its permissioned collection. A visitor reads only
 * the courses a reviewer offers to everyone. One page never mixes the two. */
const loadPage = (accountId: string | undefined, query: string, term: string, afterId?: string): Promise<AcademicCourse[]> =>
  accountId ? listAcademicCourses(query, term, afterId)
    : listPublicCourses(query, term, afterId).then(courses => courses.map(publicCatalogCourse));

/** Results are visible only to the account and query that requested them.
 * The generation also invalidates pagination after a retry or unmount. */
export function useAcademicCatalog(accountId: string | undefined, query: string, term: string) {
  const scope = JSON.stringify([accountId, query, term]);
  // A build without an account backend has no catalog to ask: no request, no loading state.
  const reachable = Boolean(accountId) || cloudConfigured();
  const [page, setPage] = useState(() => empty(scope, reachable));
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const paging = useRef(false);
  useEffect(() => {
    const request = ++generation.current;
    paging.current = false;
    setPage(current => current.scope === scope && reachable
      ? { ...current, loading: true, error: "" } : empty(scope, reachable));
    if (!reachable) return;
    const timer = window.setTimeout(() => {
      void loadPage(accountId, query, term).then(courses => {
        if (generation.current === request) setPage({ scope, courses, loading: false, more: courses.length === 24, error: "" });
      }).catch(cause => {
        if (generation.current === request) setPage(current => ({ ...(current.scope === scope ? current : empty(scope)), loading: false, error: cause instanceof Error ? cause.message : "The collection could not be loaded." }));
      });
    }, 200);
    return () => { generation.current = request + 1; window.clearTimeout(timer); };
  }, [accountId, query, term, retry, scope, reachable]);

  // Do not wait for an effect to remove another account's metadata from the UI.
  const visible = page.scope === scope ? page : empty(scope, reachable);
  async function more() {
    if (!reachable || visible.loading || !visible.more || paging.current) return;
    paging.current = true;
    const request = generation.current;
    setPage(current => ({ ...current, loading: true }));
    try {
      const courses = await loadPage(accountId, query, term, visible.courses.at(-1)?.id);
      if (generation.current === request) setPage(current => ({ scope, courses: [...current.courses, ...courses.filter(course => !current.courses.some(entry => entry.id === course.id))], loading: false, more: courses.length === 24, error: "" }));
    } catch (cause) {
      if (generation.current === request) setPage(current => ({ ...current, loading: false, error: cause instanceof Error ? cause.message : "More courses could not be loaded." }));
    } finally { if (generation.current === request) paging.current = false; }
  }
  return { ...visible, visitor: !accountId, loadMore: more, retry: () => setRetry(value => value + 1) };
}

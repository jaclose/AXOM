import { useEffect, useRef, useState } from "react";
import { listAcademicCourses, type AcademicCourse } from "./client";

interface CatalogPage {
  scope: string;
  courses: AcademicCourse[];
  loading: boolean;
  more: boolean;
  error: string;
}
const empty = (scope: string, loading = false): CatalogPage => ({ scope, courses: [], loading, more: false, error: "" });

/** Results are visible only to the account and query that requested them.
 * The generation also invalidates pagination after a retry or unmount. */
export function useAcademicCatalog(accountId: string | undefined, query: string, term: string) {
  const scope = JSON.stringify([accountId, query, term]);
  const [page, setPage] = useState(() => empty(scope, Boolean(accountId)));
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const paging = useRef(false);
  useEffect(() => {
    const request = ++generation.current;
    paging.current = false;
    setPage(current => current.scope === scope && accountId
      ? { ...current, loading: true, error: "" } : empty(scope, Boolean(accountId)));
    if (!accountId) return;
    const timer = window.setTimeout(() => {
      void listAcademicCourses(query, term).then(courses => {
        if (generation.current === request) setPage({ scope, courses, loading: false, more: courses.length === 24, error: "" });
      }).catch(cause => {
        if (generation.current === request) setPage(current => ({ ...(current.scope === scope ? current : empty(scope)), loading: false, error: cause instanceof Error ? cause.message : "The collection could not be loaded." }));
      });
    }, 200);
    return () => { generation.current = request + 1; window.clearTimeout(timer); };
  }, [accountId, query, term, retry, scope]);

  // Do not wait for an effect to remove another account's metadata from the UI.
  const visible = page.scope === scope ? page : empty(scope, Boolean(accountId));
  async function more() {
    if (!accountId || visible.loading || !visible.more || paging.current) return;
    paging.current = true;
    const request = generation.current;
    setPage(current => ({ ...current, loading: true }));
    try {
      const courses = await listAcademicCourses(query, term, visible.courses.at(-1)?.id);
      if (generation.current === request) setPage(current => ({ scope, courses: [...current.courses, ...courses.filter(course => !current.courses.some(entry => entry.id === course.id))], loading: false, more: courses.length === 24, error: "" }));
    } catch (cause) {
      if (generation.current === request) setPage(current => ({ ...current, loading: false, error: cause instanceof Error ? cause.message : "More courses could not be loaded." }));
    } finally { if (generation.current === request) paging.current = false; }
  }
  return { ...visible, loadMore: more, retry: () => setRetry(value => value + 1) };
}

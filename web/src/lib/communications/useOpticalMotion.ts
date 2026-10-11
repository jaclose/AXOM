import { useEffect, useRef } from "react";

/** Decorative CSS runs only while its surface is visible and the tab is active. */
export function useOpticalMotion<T extends HTMLElement>(revision?: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const elements = [...(ref.current?.querySelectorAll<HTMLElement>("[data-optical]") ?? [])];
    const visible = new Set<HTMLElement>();
    const sync = () => elements.forEach(element => {
      element.dataset.opticalActive = String(visible.has(element) && !document.hidden);
    });
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const element = entry.target as HTMLElement;
        if (entry.isIntersecting) visible.add(element); else visible.delete(element);
      });
      sync();
    }, { threshold: 0.05 });
    elements.forEach(element => observer.observe(element));
    document.addEventListener("visibilitychange", sync);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", sync); };
  }, [revision]);
  return ref;
}

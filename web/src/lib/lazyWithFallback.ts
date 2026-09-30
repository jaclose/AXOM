import { lazy, type ComponentType } from "react";
import { isChunkLoadError } from "./chunkErrors";

/**
 * React.lazy for parts of the always-on shell (dialogs, panels) that sit
 * outside a route's error boundary. If the chunk is gone after a deploy, the
 * part renders `Fallback` instead of throwing to the root and taking the whole
 * app down. Other errors still throw: they are real bugs.
 */
export function lazyWithFallback<P extends object>(load: () => Promise<ComponentType<P>>, Fallback: ComponentType<P>) {
  return lazy(async () => {
    try {
      return { default: await load() };
    } catch (error) {
      if (!isChunkLoadError(error)) throw error;
      return { default: Fallback };
    }
  });
}

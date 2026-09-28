import { lazy, type ComponentType, type LazyExoticComponent } from "react";

type RouteModule<T extends ComponentType<any>> = { default: T };
type RouteLoader<T extends ComponentType<any>> = () => Promise<RouteModule<T>>;

const wait = (delayMs: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, delayMs));

/**
 * Load a route chunk with one bounded retry. A transient WebView/network
 * failure should not turn a valid workspace route into a permanent error;
 * keeping the retry bounded also prevents an import loop when a deployment
 * really is broken.
 */
export const loadRouteModule = async <T extends ComponentType<any>>(
  loader: RouteLoader<T>,
  retries = 1,
  delayMs = 120,
): Promise<RouteModule<T>> => {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await loader();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await wait(delayMs);
    }
  }
  throw lastError;
};

export const lazyRoute = <T extends ComponentType<any>>(
  loader: RouteLoader<T>,
): LazyExoticComponent<T> => lazy(() => loadRouteModule(loader));

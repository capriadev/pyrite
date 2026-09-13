import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request context propagated to every log record emitted while an HTTP
 * request is being handled. Populated by the HTTP interceptor so business logs
 * from any service inherit the same reqId as the request itself.
 */
export interface RequestContext {
  reqId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

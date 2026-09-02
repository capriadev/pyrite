/**
 * Single typed client for the backend gateway. The web talks to the backend
 * ONLY through this module - never to bll/dal or any other surface.
 */
export const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:3001";

export interface HealthReport {
  app: boolean;
  postgres: boolean;
  redis: boolean;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GATEWAY_URL}${path}`, { cache: "no-store", ...init });
  if (!res.ok) {
    // /health returns 503 with the report body when a service is down
    try {
      return (await res.json()) as T;
    } catch {
      throw new Error(`gateway ${path} failed: ${res.status}`);
    }
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => request<HealthReport>("/health"),
};

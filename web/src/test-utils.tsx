import { render } from "@solidjs/testing-library";
import { createMemoryHistory, MemoryRouter } from "@solidjs/router";
import { vi } from "vitest";
import { AuthProvider } from "./auth/AuthProvider";
import { AppRoutes } from "./routes";

type MockReply = { status?: number; body?: unknown };
type MockHandler = (init?: RequestInit) => MockReply | Promise<MockReply>;

function toResponse({ status = 200, body = {} }: MockReply): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/**
 * stubFetch routes requests by "METHOD /path". Unstubbed requests fail loudly
 * so a test cannot silently depend on the real network.
 */
export function stubFetch(routes: Record<string, MockReply | MockHandler>) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input.toString();
    const path = raw.split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    const entry = routes[`${method} ${path}`] ?? routes[path];
    if (!entry) throw new Error(`unexpected fetch: ${method} ${path}`);
    const reply = typeof entry === "function" ? await entry(init) : entry;
    return toResponse(reply);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** renderAt mounts the route table under MemoryRouter at path. */
export function renderAt(path: string) {
  const history = createMemoryHistory();
  history.set({ value: path, replace: true });

  const result = render(() => (
    <AuthProvider>
      <MemoryRouter history={history}>
        <AppRoutes />
      </MemoryRouter>
    </AuthProvider>
  ));

  return { history, ...result };
}

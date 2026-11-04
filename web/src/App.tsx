import { createResource, type Component } from "solid-js";

type Health = { status: string };

async function fetchHealth(): Promise<Health> {
  const res = await fetch("/api/health");
  if (!res.ok) {
    throw new Error(`health check failed: ${res.status}`);
  }
  return (await res.json()) as Health;
}

export const App: Component = () => {
  const [health] = createResource(fetchHealth);

  return (
    <main class="shell">
      <h1>AI订阅管理工具</h1>
      <p class="tagline">Go + SolidJS 单二进制骨架</p>
      <p class="status" data-testid="backend-status">
        {health.error
          ? "后端不可用"
          : health.loading
            ? "正在检查后端…"
            : "后端已连接"}
      </p>
    </main>
  );
};

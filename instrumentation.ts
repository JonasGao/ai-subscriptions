export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { migrateProviderPlans } = await import("./lib/migrations");
    migrateProviderPlans();

    const { initScheduler } = await import("./lib/scheduler");
    initScheduler();
  }
}

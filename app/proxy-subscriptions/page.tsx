import { MainPageShell } from "@/components/MainPageShell";
import { ProxySubscriptionTab } from "@/components/ProxySubscriptionTab";

export default function ProxySubscriptionsPage() {
  return (
    <MainPageShell activePage="proxy-subscriptions">
      <ProxySubscriptionTab />
    </MainPageShell>
  );
}

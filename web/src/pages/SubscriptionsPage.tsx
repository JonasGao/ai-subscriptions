import { type Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useAuth } from "../auth/AuthProvider";

/**
 * SubscriptionsPage is the protected shell every authenticated route renders
 * under. Later tickets fill it with the subscription pages; this ticket only
 * needs the guarded landing page and the logout affordance.
 */
export const SubscriptionsPage: Component = () => {
  const auth = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await auth.logout();
    navigate("/login", { replace: true });
  };

  return (
    <main class="shell">
      <h1>AI订阅管理</h1>
      <p class="tagline">已登录：{auth.session()?.user.name ?? ""}</p>
      <nav class="shell-nav">
        <a href="/proxy-subscriptions">代理订阅</a>
      </nav>
      <button type="button" onClick={handleLogout}>
        退出登录
      </button>
    </main>
  );
};

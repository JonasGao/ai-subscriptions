import { createSignal, type Component } from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import { useAuth } from "../auth/AuthProvider";

/**
 * ChangePasswordPage ports app/change-password/page.tsx. force=1 marks the
 * first-login flow: the old stack signs out there and lands on /login, while
 * the non-forced flow keeps the caller signed in and returns to
 * /subscriptions (the server reissues their session on the new hash).
 */
export const ChangePasswordPage: Component = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  // A seed-password session is always in the forced flow, even if the query
  // parameter was dropped by a manual navigation.
  const forced = () =>
    search.force === "1" || auth.session()?.user.isInitial === true;

  const [oldPassword, setOldPassword] = createSignal("");
  const [newPassword, setNewPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);

  const handleSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    setError("");

    if (newPassword() !== confirmPassword()) {
      setError("两次输入的新密码不一致");
      return;
    }
    if (newPassword().length < 6) {
      setError("密码长度至少6位");
      return;
    }

    setLoading(true);
    try {
      await auth.changePassword(oldPassword(), newPassword());
      if (forced()) {
        // app/change-password/page.tsx: signOut() only on the forced flow.
        await auth.logout();
        navigate("/login", { replace: true });
        return;
      }
      navigate("/subscriptions", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main class="auth-shell">
      <section class="auth-card">
        <h1>{forced() ? "首次登录，请修改密码" : "修改密码"}</h1>
        <form class="auth-form" onSubmit={handleSubmit}>
          <label>
            原密码
            <input
              type="password"
              value={oldPassword()}
              onInput={(event) => setOldPassword(event.currentTarget.value)}
              placeholder={forced() ? "默认密码: admin123" : "请输入原密码"}
              autocomplete="current-password"
              required
              disabled={loading()}
            />
          </label>
          <label>
            新密码
            <input
              type="password"
              value={newPassword()}
              onInput={(event) => setNewPassword(event.currentTarget.value)}
              placeholder="请输入新密码 (至少6位)"
              autocomplete="new-password"
              required
              disabled={loading()}
            />
          </label>
          <label>
            确认新密码
            <input
              type="password"
              value={confirmPassword()}
              onInput={(event) => setConfirmPassword(event.currentTarget.value)}
              placeholder="请再次输入新密码"
              autocomplete="new-password"
              required
              disabled={loading()}
            />
          </label>
          {error() && (
            <p class="auth-error" role="alert">
              {error()}
            </p>
          )}
          <button type="submit" disabled={loading()}>
            {loading() ? "修改中..." : "确认修改"}
          </button>
          {!forced() && (
            <button
              type="button"
              class="ghost"
              onClick={() => navigate("/subscriptions")}
              disabled={loading()}
            >
              返回首页
            </button>
          )}
        </form>
      </section>
    </main>
  );
};

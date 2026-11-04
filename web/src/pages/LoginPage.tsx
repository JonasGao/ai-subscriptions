import { createSignal, onMount, type Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useAuth } from "../auth/AuthProvider";
import { fetchIsInitial } from "../auth/api";

/**
 * LoginPage ports app/login/page.tsx: username/password form, the seed-account
 * hint from /api/auth/is-initial, then /change-password?force=1 when the
 * password is still the seed (forced change) or /subscriptions otherwise.
 */
export const LoginPage: Component = () => {
  const auth = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [isInitial, setIsInitial] = createSignal(false);

  onMount(async () => {
    try {
      setIsInitial(await fetchIsInitial());
    } catch {
      setIsInitial(false);
    }
  });

  const handleSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const session = await auth.login(username(), password());
      navigate(
        session.user.isInitial ? "/change-password?force=1" : "/subscriptions",
        {
          replace: true,
        }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main class="auth-shell">
      <section class="auth-card">
        <h1>AI订阅管理</h1>
        <form class="auth-form" onSubmit={handleSubmit}>
          <label>
            用户名
            <input
              type="text"
              value={username()}
              onInput={(event) => setUsername(event.currentTarget.value)}
              placeholder="请输入用户名"
              autocomplete="username"
              required
              disabled={loading()}
            />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password()}
              onInput={(event) => setPassword(event.currentTarget.value)}
              placeholder="请输入密码"
              autocomplete="current-password"
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
            {loading() ? "登录中..." : "登录"}
          </button>
          {isInitial() && (
            <p class="auth-hint">首次登录，请使用默认凭据登录并修改密码</p>
          )}
        </form>
      </section>
    </main>
  );
};

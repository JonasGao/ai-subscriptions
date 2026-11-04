import { onMount, type Component, type JSX } from "solid-js";
import { Route, useNavigate } from "@solidjs/router";
import { SessionGate } from "./auth/AuthProvider";
import { LoginPage } from "./pages/LoginPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { SubscriptionsPage } from "./pages/SubscriptionsPage";

/** Guarded wraps a page in SessionGate (middleware.ts parity). */
const Guarded: Component<{ children: JSX.Element }> = (props) => (
  <SessionGate>{props.children}</SessionGate>
);

const guard = (page: JSX.Element): JSX.Element => <Guarded>{page}</Guarded>;

/** Home mirrors app/page.tsx: the root path redirects to /subscriptions. */
const Home: Component = () => {
  const navigate = useNavigate();
  onMount(() => navigate("/subscriptions", { replace: true }));
  return null;
};

/**
 * AppRoutes is the route table. It is Router-agnostic so tests can mount it
 * under MemoryRouter and production under the history Router.
 */
export const AppRoutes: Component = () => (
  <>
    <Route path="/login" component={() => guard(<LoginPage />)} />
    <Route
      path="/change-password"
      component={() => guard(<ChangePasswordPage />)}
    />
    <Route
      path="/subscriptions"
      component={() => guard(<SubscriptionsPage />)}
    />
    <Route path="/" component={() => guard(<Home />)} />
    <Route path="*" component={() => guard(<SubscriptionsPage />)} />
  </>
);

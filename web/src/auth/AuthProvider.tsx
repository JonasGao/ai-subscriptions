import {
  createContext,
  createEffect,
  createSignal,
  onMount,
  Show,
  useContext,
  type Accessor,
  type Component,
  type JSX,
} from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import {
  changePassword as apiChangePassword,
  fetchSession,
  login as apiLogin,
  logout as apiLogout,
  type Session,
} from "./api";

/** AuthContextValue is the session state and the three auth actions. */
export interface AuthContextValue {
  session: Accessor<Session | null>;
  loading: Accessor<boolean>;
  login: (username: string, password: string) => Promise<Session>;
  logout: () => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>();

/** useAuth reads the session context; it must sit under AuthProvider. */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

/**
 * AuthProvider loads the session once on mount. Login/change-password update
 * the local signal so the guard reacts without a second round trip.
 */
export const AuthProvider: Component<{ children: JSX.Element }> = (props) => {
  const [session, setSession] = createSignal<Session | null>(null);
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    try {
      setSession(await fetchSession());
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  });

  const value: AuthContextValue = {
    session,
    loading,
    async login(username, password) {
      const next = await apiLogin(username, password);
      setSession(next);
      return next;
    },
    async logout() {
      await apiLogout();
      setSession(null);
    },
    async changePassword(oldPassword, newPassword) {
      await apiChangePassword(oldPassword, newPassword);
      // The server revokes every token bound to the old hash but reissues one
      // for the caller, so refresh the session instead of dropping it: the
      // non-forced flow stays signed in (and isInitial flips to false).
      try {
        setSession(await fetchSession());
      } catch {
        setSession(null);
      }
    },
  };

  return (
    <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>
  );
};

const LOGIN_PATH = "/login";
const CHANGE_PASSWORD_PATH = "/change-password";
const HOME_PATH = "/subscriptions";

function isAllowed(
  pathname: string,
  user: Session["user"] | undefined
): boolean {
  if (pathname === LOGIN_PATH) return !user;
  if (!user) return false;
  if (user.isInitial && pathname !== CHANGE_PASSWORD_PATH) return false;
  return true;
}

/**
 * SessionGate implements the client half of the route guard (the old stack
 * enforced it in middleware.ts): anonymous visitors to any page land on
 * /login, a seed-password session is forced to /change-password, and a
 * logged-in visitor on /login is sent to /subscriptions.
 */
export const SessionGate: Component<{ children: JSX.Element }> = (props) => {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  createEffect(() => {
    if (auth.loading()) return;
    const pathname = location.pathname;
    const user = auth.session()?.user;
    if (isAllowed(pathname, user)) return;

    if (!user) {
      navigate(LOGIN_PATH, { replace: true });
      return;
    }
    if (user.isInitial) {
      navigate(`${CHANGE_PASSWORD_PATH}?force=1`, { replace: true });
      return;
    }
    navigate(HOME_PATH, { replace: true });
  });

  return (
    <Show when={!auth.loading()} fallback={<p class="loading">加载中...</p>}>
      <Show
        when={isAllowed(location.pathname, auth.session()?.user)}
        fallback={null}
      >
        {props.children}
      </Show>
    </Show>
  );
};

import { type Component } from "solid-js";
import { Router } from "@solidjs/router";
import { AuthProvider } from "./auth/AuthProvider";
import { AppRoutes } from "./routes";

export const App: Component = () => (
  <AuthProvider>
    <Router>
      <AppRoutes />
    </Router>
  </AuthProvider>
);

import { render } from "solid-js/web";
import { App } from "./App";
import { themeStore } from "./theme";
import "./styles.css";

// Boot the theme store before the first render so the persisted class lands on
// <html> without a flash of the wrong palette.
themeStore();

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root not found in index.html");
}

render(() => <App />, root);

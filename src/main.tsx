import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { useStore } from "./state/store";
import { initSync } from "./sync";
// Free equivalents of the game's UI fonts (Fira Sans is used directly; serves as the
// Iskra fallback. Noto Sans TC covers the CJK strings). Weights we render: 400/700 + italic.
import "@fontsource/fira-sans/400.css";
import "@fontsource/fira-sans/700.css";
import "@fontsource/fira-sans/400-italic.css";
import "@fontsource/noto-sans-tc/400.css";
import "@fontsource/noto-sans-tc/700.css";
import "./index.css";

// Mirror the store across windows (main <-> popped-out panels) before the first render.
initSync(useStore);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

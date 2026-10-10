import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource/vt323/400.css";
import "@fontsource/silkscreen/400.css";
import "@fontsource/orbitron/700.css";
import "./index.css";
import "./classic/skins.css";
import "./classic/classic.css";
import "./classic/y2k.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

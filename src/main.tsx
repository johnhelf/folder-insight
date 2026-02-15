import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

/**
 * 移除启动加载占位，避免首屏白屏观感。
 */
const removeSplash = () => {
  const splash = document.getElementById("app-splash");
  if (splash) {
    splash.remove();
  }
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

requestAnimationFrame(removeSplash);

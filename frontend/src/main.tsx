import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import QuickInspect from "./QuickInspect";
import "./styles.css";

// http://127.0.0.1:8000/business is the simple one-click page; everything else is the original workspace.
const business = location.pathname.replace(/\/$/, "") === "/business";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {business ? (
      <QuickInspect onOpenWorkspace={() => location.assign("/")} />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);

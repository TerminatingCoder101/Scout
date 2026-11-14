import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import QuickInspect from "./QuickInspect";
import "./styles.css";

// Business page (simple one-click flow) at /#business; everything else is the original workspace.
const business = location.hash.startsWith("#business");
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {business ? (
      <QuickInspect
        onOpenWorkspace={() => {
          location.hash = "";
          location.reload();
        }}
      />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);

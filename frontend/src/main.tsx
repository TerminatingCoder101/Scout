import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import QuickInspect from "./QuickInspect";
import "./styles.css";

// Business page (simple one-click flow) at /#business; everything else is the original workspace.
const isBusiness = () => location.hash.startsWith("#business");
function Root() {
  const [business, setBusiness] = useState(isBusiness);
  useEffect(() => {
    // Switch as soon as the address changes, even without a reload.
    const onHash = () => setBusiness(isBusiness());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  return business ? (
    <QuickInspect
      onOpenWorkspace={() => {
        location.hash = "";
      }}
    />
  ) : (
    <App />
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);

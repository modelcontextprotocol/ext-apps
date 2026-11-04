import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import StitchApp from "./StitchApp";
import "./global.css";

const root = document.getElementById("app");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <StitchApp />
    </StrictMode>,
  );
}

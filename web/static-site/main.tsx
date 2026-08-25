import React from "react";
import { createRoot } from "react-dom/client";
import { productSpaceFromPath } from "../app/product-space";
import { RadarDashboard } from "../app/radar-dashboard";
import "../app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Meta Radar root element is missing");
}

createRoot(root).render(
  <React.StrictMode>
    <RadarDashboard initialSpace={productSpaceFromPath(window.location.pathname)} />
  </React.StrictMode>,
);

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const addTag = (tag, attrs) => {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => (el[k] = v));
  document.head.appendChild(el);
};

addTag("link", { rel: "stylesheet", href: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" });
addTag("script", { src: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" });

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><App /></React.StrictMode>
);
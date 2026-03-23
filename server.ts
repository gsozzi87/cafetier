import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { initDB } from "./db";
import api from "./api";

initDB();

const app = new Hono();

// API routes
app.route("/api", api);

// Static files desde la raíz del proyecto
app.use("/*", serveStatic({ root: "./" }));

// SPA fallback
app.get("*", serveStatic({ path: "./index.html" }));

const port = parseInt(process.env.PORT || "3000", 10);

console.log(`☕ CAFETIER running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
  hostname: "0.0.0.0",
});

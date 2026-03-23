import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { initDB } from "./db";
import api from "./api";

initDB();

const app = new Hono();

// API routes
app.route("/api", api);

// Static files
app.use("/*", serveStatic({ root: "./public" }));

// SPA fallback
app.get("*", serveStatic({ path: "./public/index.html" }));

const port = parseInt(process.env.PORT || "3000");
console.log(`☕ CAFETIER running on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};

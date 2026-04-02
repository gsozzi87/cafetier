import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import api from "./api";
import { initDB } from "./db";

initDB();

const app = new Hono();
app.get("/api/healthz", c => c.json({ ok: true }));
app.route("/api", api);
app.use("/*", serveStatic({ root: "./public" }));
app.get("*", serveStatic({ path: "./public/index.html" }));

const port = Number(process.env.PORT || 3000);
console.log(`☕ CAFETIER v4 corriendo en puerto ${port}`);

export default { port, fetch: app.fetch };

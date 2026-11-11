import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";

function equalSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// Only published site content and media are readable without login.
// All other API routes, including financial data and destructive actions, are private.
function publicApiRead(pathname: string, method: string): boolean {
  return method === "GET" && (
    pathname === "/api/healthz" ||
    /^\/api\/site-content\/[a-z0-9_-]+$/.test(pathname) ||
    /^\/api\/site-media\/[0-9]+$/.test(pathname)
  );
}

function privateRoute(pathname: string, method: string): boolean {
  if (pathname === "/api" || pathname.startsWith("/api/")) return !publicApiRead(pathname, method);
  return /^\/(admin|editor-sitio)(\/|$)/.test(pathname);
}

function validCredentials(header: string | undefined): boolean {
  const expectedPassword = process.env.ADMIN_PASSWORD;
  if (!expectedPassword || !header || !/^Basic [A-Za-z0-9+/=]+$/i.test(header)) return false;
  let raw = "";
  try { raw = Buffer.from(header.slice(6), "base64").toString("utf8"); } catch { return false; }
  const colon = raw.indexOf(":");
  if (colon < 0) return false;
  return equalSecret(raw.slice(0, colon), process.env.ADMIN_USER || "admin") &&
         equalSecret(raw.slice(colon + 1), expectedPassword);
}

import { serveStatic } from "hono/bun";
import api from "./api";
import { initDB } from "./db";

initDB();

const app = new Hono();

// Fail closed if ADMIN_PASSWORD was not configured on the host.
app.use("*", async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  const url = new URL(c.req.url);
  const method = c.req.method.toUpperCase();
  if (!privateRoute(url.pathname, method)) return next();

  c.header("Cache-Control", "no-store");
  if (!process.env.ADMIN_PASSWORD) return c.text("Acceso administrativo no configurado.", 503);
  if (!validCredentials(c.req.header("Authorization"))) {
    c.header("WWW-Authenticate", 'Basic realm="Cafetier Admin", charset="UTF-8"');
    return c.text("Autenticación requerida.", 401);
  }

  // CSRF: the custom header X-Cafetier-Request cannot be sent cross-origin without CORS preflight.
  // Origin check uses the Host/X-Forwarded-Host header so it works behind Railway's reverse proxy.
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    if (c.req.header("X-Cafetier-Request") !== "1") return c.text("Solicitud no autorizada.", 403);
    const origin = c.req.header("Origin");
    if (origin) {
      const fwdHost = c.req.header("X-Forwarded-Host") || c.req.header("Host") || url.host;
      const fwdProto = c.req.header("X-Forwarded-Proto") || url.protocol.replace(":", "");
      const expected = `${fwdProto}://${fwdHost}`;
      if (origin !== expected) return c.json({ success: false, error: "Origen no autorizado." }, 403);
    }
  }
  return next();
});
app.get("/api/healthz", c => c.json({ ok: true }));
app.route("/api", api);
app.get("/admin", serveStatic({ path: "./public/admin/index.html" }));
app.get("/admin/", serveStatic({ path: "./public/admin/index.html" }));
app.get("/editor-sitio", serveStatic({ path: "./public/editor-sitio/index.html" }));
app.get("/editor-sitio/", serveStatic({ path: "./public/editor-sitio/index.html" }));
app.get("/nuestro-cafe", serveStatic({ path: "./public/nuestro-cafe/index.html" }));
app.get("/nuestro-cafe/", serveStatic({ path: "./public/nuestro-cafe/index.html" }));
app.get("/para-negocios", serveStatic({ path: "./public/para-negocios/index.html" }));
app.get("/para-negocios/", serveStatic({ path: "./public/para-negocios/index.html" }));
app.get("/proceso", serveStatic({ path: "./public/proceso/index.html" }));
app.get("/proceso/", serveStatic({ path: "./public/proceso/index.html" }));
app.get("/marca", serveStatic({ path: "./public/marca/index.html" }));
app.get("/marca/", serveStatic({ path: "./public/marca/index.html" }));
app.get("/pedidos", serveStatic({ path: "./public/pedidos/index.html" }));
app.get("/pedidos/", serveStatic({ path: "./public/pedidos/index.html" }));
app.use("/*", serveStatic({ root: "./public" }));
app.get("*", serveStatic({ path: "./public/index.html" }));

const port = Number(process.env.PORT || 3000);
console.log(`CAFETIER v4 corriendo en puerto ${port}`);

export default { port, fetch: app.fetch };

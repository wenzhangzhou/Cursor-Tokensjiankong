"use strict";

const https = require("https");

const BASE = "https://cursor.com";

function safeSnippet(text) {
  return String(text || "")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]")
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function requestJson(pathname, { method = "GET", cookie, body, timeoutMs = 30000 } = {}) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
  const headers = {
    Accept: "application/json",
    Cookie: cookie,
    "User-Agent": "cursor-usage-workbench/0.1",
  };
  if (payload) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(payload.length);
    headers.Origin = BASE;
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      BASE + pathname,
      { method, headers, timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          if (raw) {
            try {
              json = JSON.parse(raw);
            } catch {
              json = null;
            }
          }
          resolve({
            status: res.statusCode || 0,
            json,
            rawSnippet: safeSnippet(raw),
          });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("请求超时")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = { requestJson, safeSnippet };

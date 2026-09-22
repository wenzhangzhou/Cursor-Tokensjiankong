"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { syncUsage } = require("./lib/sync");
const { buildSummary, toCsv } = require("./lib/report");
const { ensureHooks } = require("./lib/hooks-install");

const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
const PUBLIC = path.join(ROOT, "public");
const HOST = "127.0.0.1";
const PORT = 3790;

fs.mkdirSync(DATA, { recursive: true });

const hookScript = path.join(ROOT, "hooks", "record-task.js");
const hookInstall = ensureHooks(hookScript);
if (hookInstall.changed) {
  console.log("已写入 Cursor hooks：" + hookInstall.file);
  console.log("stop / sessionEnd → record-task.js。已打开的 Cursor 窗口需要重载 hooks 或重启后才会生效。");
} else {
  console.log("Cursor hooks 已包含 record-task.js，未重复添加。");
}

let syncing = null;

function send(res, status, body, headers) {
  const payload = Buffer.from(body);
  res.writeHead(status, Object.assign({ "Content-Length": payload.length, "Cache-Control": "no-store" }, headers));
  res.end(payload);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), { "Content-Type": "application/json; charset=utf-8" });
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function serveStatic(res, name) {
  const file = path.join(PUBLIC, name);
  if (!file.startsWith(PUBLIC)) {
    send(res, 404, "not found");
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      send(res, 404, "not found");
      return;
    }
    send(res, 200, buf, { "Content-Type": contentType(file) });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    serveStatic(res, "index.html");
    return;
  }
  if (req.method === "GET" && (url.pathname === "/app.js" || url.pathname === "/app.css")) {
    serveStatic(res, url.pathname.slice(1));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/summary") {
    sendJson(res, 200, buildSummary(DATA));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/export.csv") {
    const csv = toCsv(buildSummary(DATA));
    send(res, 200, csv, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=cursor-usage.csv",
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/sync") {
    if (syncing) {
      sendJson(res, 409, { ok: false, error: "正在同步，请稍候" });
      return;
    }
    syncing = syncUsage(DATA)
      .then((meta) => {
        sendJson(res, 200, { ok: true, meta, summary: buildSummary(DATA) });
      })
      .catch((err) => {
        const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
        sendJson(res, status === 401 ? 401 : 502, {
          ok: false,
          error: err.message || "同步失败",
        });
      })
      .finally(() => {
        syncing = null;
      });
    return;
  }
  send(res, 404, "not found");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error("端口 3790 已被占用。请关掉已打开的工作台窗口后再启动。");
  } else {
    console.error(err.message || err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const address = "http://" + HOST + ":" + PORT + "/";
  console.log("Cursor 用量工作台已启动：" + address);
  console.log("只监听本机，不同步到其他电脑。账单数字只在点击同步后出现。");
  if (process.env.CURSOR_USAGE_OPEN === "1") {
    spawn("cmd", ["/c", "start", "", address], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  }
});

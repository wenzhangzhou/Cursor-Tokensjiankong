"use strict";

const fs = require("fs");
const path = require("path");
const { requestJson, safeSnippet } = require("./http-json");
const { readAccessToken, decodeJwtPayload, loadComposers } = require("./cursor-db");

function writeJson(file, value) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function cookieFor(sub, jwt) {
  return "WorkosCursorSessionToken=" + String(sub) + "%3A%3A" + jwt;
}

function fail(status, message, extra) {
  const error = new Error(message);
  error.status = status;
  error.extra = extra || null;
  return error;
}

async function fetchAllEvents(cookie, userId, startMs, endMs) {
  const pageSize = 500;
  const first = await requestJson("/api/dashboard/get-filtered-usage-events", {
    method: "POST",
    cookie,
    body: {
      teamId: 0,
      startDate: String(startMs),
      endDate: String(endMs),
      userId,
      page: 1,
      pageSize,
    },
  });
  if (first.status === 401 || first.status === 403) {
    throw fail(first.status, "未登录或会话已失效（用量接口 HTTP " + first.status + "）", first.rawSnippet);
  }
  if (first.status !== 200 || !first.json || !Array.isArray(first.json.usageEventsDisplay)) {
    const keys = first.json && typeof first.json === "object" ? Object.keys(first.json).join(", ") : "";
    throw fail(
      first.status,
      "用量接口变更或被拒绝：get-filtered-usage-events HTTP " + first.status + (keys ? "，字段 " + keys : ""),
      first.rawSnippet
    );
  }
  const total = Number(first.json.totalUsageEventsCount || 0);
  const events = first.json.usageEventsDisplay.slice();
  let page = 2;
  while (events.length < total && page <= 200) {
    const chunk = await requestJson("/api/dashboard/get-filtered-usage-events", {
      method: "POST",
      cookie,
      body: {
        teamId: 0,
        startDate: String(startMs),
        endDate: String(endMs),
        userId,
        page,
        pageSize,
      },
    });
    if (chunk.status !== 200 || !chunk.json || !Array.isArray(chunk.json.usageEventsDisplay)) {
      throw fail(chunk.status, "用量明细分页中断：HTTP " + chunk.status + "（第 " + page + " 页）", chunk.rawSnippet);
    }
    if (chunk.json.usageEventsDisplay.length === 0) break;
    events.push(...chunk.json.usageEventsDisplay);
    page += 1;
  }
  return { events, total };
}

function monthStartMs(now) {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

function weekStartMs(now) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = start.getDay();
  const diff = day === 0 ? 6 : day - 1;
  start.setDate(start.getDate() - diff);
  return start.getTime();
}

async function syncUsage(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  let token;
  try {
    token = readAccessToken();
  } catch (err) {
    throw fail(401, err.message);
  }

  let payload;
  try {
    payload = decodeJwtPayload(token);
  } catch {
    throw fail(401, "登录态无效：无法解析 accessToken");
  }
  const sub = payload && payload.sub;
  if (!sub) throw fail(401, "登录态无效：JWT 里没有 sub");

  const cookie = cookieFor(sub, token);
  const meRes = await requestJson("/api/auth/me", { cookie });
  if (meRes.status !== 200 || !meRes.json || meRes.json.id == null) {
    throw fail(
      meRes.status || 401,
      meRes.status === 401 || meRes.status === 204 || meRes.status === 0
        ? "未登录：/api/auth/me 没有返回账号（HTTP " + (meRes.status || 0) + "）"
        : "登录接口变更或被拒绝：/api/auth/me HTTP " + meRes.status,
      meRes.rawSnippet
    );
  }

  const userId = meRes.json.id;
  const now = new Date();
  const endMs = now.getTime();
  let usageMeta = null;
  const usageRes = await requestJson("/api/usage?user=" + encodeURIComponent(String(userId)), { cookie });
  if (usageRes.status === 200 && usageRes.json) usageMeta = usageRes.json;

  const billingStart = usageMeta && usageMeta.startOfMonth ? Number(usageMeta.startOfMonth) : NaN;
  const startMs = Math.min(monthStartMs(now), weekStartMs(now), Number.isFinite(billingStart) ? billingStart : endMs);
  const rangeStart = Math.min(startMs, endMs - 31 * 24 * 3600 * 1000);

  const aggregatedRes = await requestJson("/api/dashboard/get-aggregated-usage-events", {
    method: "POST",
    cookie,
    body: {
      teamId: 0,
      startDate: String(rangeStart),
      endDate: String(endMs),
      userId,
    },
  });
  if (aggregatedRes.status !== 200 || !aggregatedRes.json) {
    throw fail(
      aggregatedRes.status,
      "用量汇总接口变更或被拒绝：get-aggregated-usage-events HTTP " + aggregatedRes.status,
      aggregatedRes.rawSnippet
    );
  }

  const { events, total } = await fetchAllEvents(cookie, userId, rangeStart, endMs);
  let composers = [];
  try {
    composers = loadComposers();
  } catch (err) {
    composers = [];
    usageMeta = Object.assign({}, usageMeta, { composerWarning: err.message });
  }

  const savedAt = new Date().toISOString();
  writeJson(path.join(dataDir, "usage-events.json"), events);
  writeJson(path.join(dataDir, "aggregated.json"), aggregatedRes.json);
  writeJson(path.join(dataDir, "composers.json"), composers);
  const meta = {
    ok: true,
    syncedAt: savedAt,
    email: meRes.json.email || "",
    userId,
    rangeStart,
    rangeEnd: endMs,
    eventCount: events.length,
    totalReported: total,
    composerCount: composers.length,
    namedComposerCount: composers.filter((item) => item.name).length,
    warning: events.length < total ? "明细条数少于接口报告的总数，可能被分页上限截断" : "",
    composerWarning: (usageMeta && usageMeta.composerWarning) || "",
  };
  writeJson(path.join(dataDir, "sync-meta.json"), meta);
  return meta;
}

function readSyncErrorSnippet(err) {
  return safeSnippet(err && (err.extra || err.message));
}

module.exports = { syncUsage, readSyncErrorSnippet };

"use strict";

const fs = require("fs");
const path = require("path");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  const rows = [];
  for (const line of text.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      /* skip broken line */
    }
  }
  return rows;
}

function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function eventTime(event) {
  const n = num(event && (event.timestamp || event.time || event.createdAt));
  return n == null ? null : n;
}

function tokenParts(event) {
  const usage = (event && (event.tokenUsage || event.token_usage)) || {};
  return {
    input: num(usage.inputTokens),
    output: num(usage.outputTokens),
    cacheRead: num(usage.cacheReadTokens),
    cacheWrite: num(usage.cacheWriteTokens),
    cents: num(usage.totalCents != null ? usage.totalCents : event && event.chargedCents),
  };
}

function blankTotals() {
  return {
    count: 0,
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
    cents: null,
    hasInput: false,
    hasOutput: false,
    hasCacheRead: false,
    hasCacheWrite: false,
    hasCents: false,
  };
}

function addTotals(bucket, event) {
  const parts = tokenParts(event);
  bucket.count += 1;
  if (parts.input != null) {
    bucket.input = (bucket.input || 0) + parts.input;
    bucket.hasInput = true;
  }
  if (parts.output != null) {
    bucket.output = (bucket.output || 0) + parts.output;
    bucket.hasOutput = true;
  }
  if (parts.cacheRead != null) {
    bucket.cacheRead = (bucket.cacheRead || 0) + parts.cacheRead;
    bucket.hasCacheRead = true;
  }
  if (parts.cacheWrite != null) {
    bucket.cacheWrite = (bucket.cacheWrite || 0) + parts.cacheWrite;
    bucket.hasCacheWrite = true;
  }
  if (parts.cents != null) {
    bucket.cents = (bucket.cents || 0) + parts.cents;
    bucket.hasCents = true;
  }
}

function publishTotals(bucket) {
  return {
    count: bucket.count,
    input: bucket.hasInput ? bucket.input : null,
    output: bucket.hasOutput ? bucket.output : null,
    cacheRead: bucket.hasCacheRead ? bucket.cacheRead : null,
    cacheWrite: bucket.hasCacheWrite ? bucket.cacheWrite : null,
    cents: bucket.hasCents ? bucket.cents : null,
  };
}

function startOfDay(ms) {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function weekStart(ms) {
  const date = new Date(startOfDay(ms));
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - diff);
  return date.getTime();
}

function monthStart(ms) {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function dayKey(ms) {
  const date = new Date(ms);
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return date.getFullYear() + "-" + m + "-" + d;
}

function displayTitle(composer) {
  if (!composer) return "未命名会话";
  if (composer.name) return composer.name;
  if (composer.isSubagent && composer.subagentTypeName) return composer.subagentTypeName;
  return "未命名会话";
}

function hookTitleMap(hooks) {
  const map = new Map();
  for (const row of hooks) {
    const id = String(row.conversationId || row.sessionId || "");
    if (!id || !row.title || row.title === "未命名会话") continue;
    map.set(id, row.title);
  }
  return map;
}

function localComposer(event, composers) {
  const conversationId = String((event && event.conversationId) || "");
  if (!conversationId) return null;
  return composers.find((item) => item.composerId === conversationId) || null;
}

function buildSummary(dataDir) {
  const meta = readJson(path.join(dataDir, "sync-meta.json"), null);
  const events = readJson(path.join(dataDir, "usage-events.json"), []);
  const composers = readJson(path.join(dataDir, "composers.json"), []);
  const hooks = readJsonl(path.join(dataDir, "task-events.jsonl"));
  const titles = hookTitleMap(hooks);
  const now = Date.now();
  const todayStart = startOfDay(now);
  const thisWeek = weekStart(now);
  const thisMonth = monthStart(now);

  const periods = {
    today: blankTotals(),
    week: blankTotals(),
    month: blankTotals(),
  };
  const outside = {
    today: blankTotals(),
    week: blankTotals(),
    month: blankTotals(),
  };
  const byDay = new Map();
  const byModel = new Map();
  const byTask = new Map();

  for (const event of Array.isArray(events) ? events : []) {
    const ts = eventTime(event);
    if (ts == null) continue;
    const composer = localComposer(event, composers);
    const bucket = composer ? periods : outside;
    if (ts >= todayStart) addTotals(bucket.today, event);
    if (ts >= thisWeek) addTotals(bucket.week, event);
    if (ts >= thisMonth) addTotals(bucket.month, event);
    if (!composer) continue;

    const day = dayKey(ts);
    if (!byDay.has(day)) byDay.set(day, blankTotals());
    addTotals(byDay.get(day), event);

    const model = String(event.model || "未知模型");
    if (!byModel.has(model)) byModel.set(model, blankTotals());
    addTotals(byModel.get(model), event);

    const taskId = composer.composerId;
    if (!byTask.has(taskId)) {
      const hooked = titles.get(composer.composerId) || "";
      byTask.set(taskId, {
        id: taskId,
        title: hooked || displayTitle(composer),
        untitled: !(hooked || composer.name || (composer.isSubagent && composer.subagentTypeName)),
        isSubagent: Boolean(composer.isSubagent),
        workspace: composer.workspace || "",
        lastAt: ts,
        totals: blankTotals(),
      });
    }
    const task = byTask.get(taskId);
    if (ts > task.lastAt) task.lastAt = ts;
    addTotals(task.totals, event);
  }

  const tasks = Array.from(byTask.values())
    .map((task) => Object.assign({}, task, { totals: publishTotals(task.totals) }))
    .sort((a, b) => {
      const ta = (a.totals.input || 0) + (a.totals.output || 0) + (a.totals.cacheRead || 0) + (a.totals.cacheWrite || 0);
      const tb = (b.totals.input || 0) + (b.totals.output || 0) + (b.totals.cacheRead || 0) + (b.totals.cacheWrite || 0);
      return tb - ta || b.lastAt - a.lastAt;
    });

  const days = Array.from(byDay.entries())
    .map(([date, totals]) => ({ date, totals: publishTotals(totals) }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const models = Array.from(byModel.entries())
    .map(([model, totals]) => ({ model, totals: publishTotals(totals) }))
    .sort((a, b) => (b.totals.cents || 0) - (a.totals.cents || 0) || b.totals.count - a.totals.count);

  return {
    synced: Boolean(meta && meta.ok),
    meta,
    periods: {
      today: publishTotals(periods.today),
      week: publishTotals(periods.week),
      month: publishTotals(periods.month),
    },
    outside: {
      today: publishTotals(outside.today),
      week: publishTotals(outside.week),
      month: publishTotals(outside.month),
    },
    tasks,
    days,
    models,
    hookCount: hooks.length,
  };
}

function toCsv(summary) {
  const header = ["日期", "模型或任务", "类别", "次数", "输入", "输出", "缓存读", "缓存写", "费用美分"];
  const lines = [header.join(",")];
  function cell(value) {
    const text = value == null ? "" : String(value);
    if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }
  function push(kind, name, totals, date) {
    lines.push(
      [date || "", name, kind, totals.count, totals.input, totals.output, totals.cacheRead, totals.cacheWrite, totals.cents]
        .map(cell)
        .join(",")
    );
  }
  for (const day of summary.days) push("按日", "", day.totals, day.date);
  for (const model of summary.models) push("按模型", model.model, model.totals, "");
  for (const task of summary.tasks) push("按任务", task.title, task.totals, "");
  if (summary.outside) {
    push("未在本机留下对话", "今日", summary.outside.today, "");
    push("未在本机留下对话", "本周", summary.outside.week, "");
    push("未在本机留下对话", "本月", summary.outside.month, "");
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

module.exports = { buildSummary, toCsv };

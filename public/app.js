"use strict";

const $ = (id) => document.getElementById(id);

function fmtInt(value) {
  if (value == null) return "—";
  return new Intl.NumberFormat("zh-CN").format(value);
}

function fmtUsd(cents) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function fmtTime(ms) {
  if (!ms) return "—";
  const date = new Date(ms);
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return m + "-" + d + " " + hh + ":" + mm;
}

function periodBit(totals) {
  const sum = tokenSum(totals || {});
  const count = (totals && totals.count) || 0;
  if (!count) return "0 次";
  return count + " 次 / " + (sum == null ? "无 token" : fmtInt(sum) + " token") + " / " + fmtUsd(totals.cents);
}

function tokenSum(totals) {
  const parts = [totals.input, totals.output, totals.cacheRead, totals.cacheWrite];
  if (parts.every((part) => part == null)) return null;
  return parts.reduce((sum, part) => sum + (part || 0), 0);
}

function fillCard(id, totals, synced) {
  const card = $(id);
  const figure = card.querySelector(".figure");
  const detail = card.querySelector(".detail");
  if (!synced) {
    figure.textContent = "尚未同步";
    detail.textContent = "";
    return;
  }
  if (!totals.count) {
    figure.textContent = "0";
    detail.textContent = "次数 0 · 费用 —";
    return;
  }
  const sum = tokenSum(totals);
  figure.textContent = sum == null ? "无 token 字段" : fmtInt(sum);
  const bits = ["次数 " + fmtInt(totals.count), "费用 " + fmtUsd(totals.cents)];
  detail.textContent = bits.join(" · ");
}

function rowCells(totals, withCache) {
  const cells = [fmtInt(totals.count), fmtInt(totals.input), fmtInt(totals.output)];
  if (withCache) cells.push(fmtInt(totals.cacheRead), fmtInt(totals.cacheWrite));
  cells.push(fmtUsd(totals.cents));
  return cells.map((text) => "<td>" + text + "</td>").join("");
}

function render(summary) {
  const synced = Boolean(summary && summary.synced);
  fillCard("card-today", summary.periods.today, synced);
  fillCard("card-week", summary.periods.week, synced);
  fillCard("card-month", summary.periods.month, synced);

  const outside = summary.outside || { today: {}, week: {}, month: {} };
  const outsideBox = $("outside");
  if (synced) {
    outsideBox.hidden = false;
    $("outside-text").textContent = [
      "今日 " + periodBit(outside.today),
      "本周 " + periodBit(outside.week),
      "本月 " + periodBit(outside.month),
    ].join(" · ") + "。这些不计入上面的卡片。";
  } else {
    outsideBox.hidden = true;
  }

  const meta = $("sync-meta");
  if (summary.meta && summary.meta.syncedAt) {
    const when = new Date(summary.meta.syncedAt);
    const who = summary.meta.email ? " · " + summary.meta.email : "";
    meta.textContent = "上次同步 " + when.toLocaleString("zh-CN") + who + " · 明细 " + summary.meta.eventCount + " 条";
    if (summary.meta.warning) meta.textContent += " · " + summary.meta.warning;
  } else {
    meta.textContent = "尚未同步";
  }

  const tasks = $("tasks");
  if (!summary.tasks.length) {
    tasks.innerHTML = '<tr><td colspan="8" class="empty">' + (synced
      ? "本机对话列表里没有和这些账单对得上的记录。"
      : "同步之后，这里只显示本机对话。") + "</td></tr>";
  } else {
    tasks.innerHTML = summary.tasks.map((task) => {
      const tag = task.isSubagent ? '<span class="tag">子任务</span>' : "";
      const id = task.untitled ? '<span class="id">' + task.id.slice(0, 8) + "</span>" : "";
      return "<tr><td>" + escapeHtml(task.title) + tag + id + "</td>" + rowCells(task.totals, true) + "<td>" + fmtTime(task.lastAt) + "</td></tr>";
    }).join("");
  }

  $("days").innerHTML = summary.days.length
    ? summary.days.map((day) => "<tr><td>" + day.date + "</td>" + rowCells(day.totals, false) + "</tr>").join("")
    : '<tr><td colspan="5" class="empty">没有按日数据</td></tr>';

  $("models").innerHTML = summary.models.length
    ? summary.models.map((model) => "<tr><td>" + escapeHtml(model.model) + "</td>" + rowCells(model.totals, false) + "</tr>").join("")
    : '<tr><td colspan="5" class="empty">没有按模型数据</td></tr>';
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showError(message) {
  const box = $("error");
  if (!message) {
    box.hidden = true;
    box.textContent = "";
    return;
  }
  box.hidden = false;
  box.textContent = message;
}

async function loadSummary() {
  const res = await fetch("/api/summary", { cache: "no-store" });
  const summary = await res.json();
  render(summary);
}

async function syncNow() {
  const button = $("sync");
  button.disabled = true;
  showError("");
  button.textContent = "正在同步…";
  try {
    const res = await fetch("/api/sync", { method: "POST" });
    const body = await res.json();
    if (!res.ok || !body.ok) {
      showError(body.error || "同步失败");
      await loadSummary();
      return;
    }
    render(body.summary);
  } catch (err) {
    showError("同步失败：" + (err.message || "网络错误"));
  } finally {
    button.disabled = false;
    button.textContent = "同步用量";
  }
}

$("sync").addEventListener("click", syncNow);
loadSummary().catch((err) => showError("页面数据读取失败：" + err.message));

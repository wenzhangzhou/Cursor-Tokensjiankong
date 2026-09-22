"use strict";

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

function stateDbPath() {
  const appData = process.env.APPDATA;
  if (!appData) return null;
  return path.join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
}

function openStateDb() {
  const dbPath = stateDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) {
    const error = new Error("未找到 Cursor 登录数据库 state.vscdb");
    error.code = "NO_DB";
    throw error;
  }
  try {
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch (err) {
    const error = new Error("无法只读打开 state.vscdb：" + (err.message || "未知错误"));
    error.code = "DB_LOCKED";
    throw error;
  }
}

function readAccessToken() {
  const db = openStateDb();
  try {
    const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get("cursorAuth/accessToken");
    if (!row || row.value == null) {
      const error = new Error("未登录：state.vscdb 里没有 cursorAuth/accessToken");
      error.code = "NO_TOKEN";
      throw error;
    }
    let token = Buffer.isBuffer(row.value) ? row.value.toString("utf8") : String(row.value);
    token = token.trim().replace(/^"|"$/g, "");
    if (!token || token.split(".").length < 3) {
      const error = new Error("登录态无效：accessToken 不是 JWT");
      error.code = "BAD_TOKEN";
      throw error;
    }
    return token;
  } finally {
    db.close();
  }
}

function decodeJwtPayload(token) {
  const part = token.split(".")[1] || "";
  const padded = part + "=".repeat((4 - (part.length % 4)) % 4);
  const json = Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  return JSON.parse(json);
}

function workspaceHint(value) {
  const id = value && value.workspaceIdentifier;
  if (!id) return "";
  if (typeof id === "string") return id;
  if (typeof id === "object") {
    return String(id.fsPath || id.path || id.uri || id.id || "");
  }
  return "";
}

function loadComposers() {
  const db = openStateDb();
  try {
    const rows = db
      .prepare(
        "SELECT composerId, createdAt, lastUpdatedAt, isArchived, isSubagent, subagentTypeName, value FROM composerHeaders"
      )
      .all();
    const composers = [];
    for (const row of rows) {
      let value = {};
      try {
        value = JSON.parse(row.value || "{}");
      } catch {
        value = {};
      }
      const name = String(value.name || "").trim();
      const createdAt = Number(row.createdAt || value.createdAt || 0);
      const lastUpdatedAt = Number(row.lastUpdatedAt || value.lastUpdatedAt || 0);
      composers.push({
        composerId: String(row.composerId || value.composerId || ""),
        name,
        createdAt: Number.isFinite(createdAt) ? createdAt : 0,
        lastUpdatedAt: Number.isFinite(lastUpdatedAt) ? lastUpdatedAt : 0,
        isSubagent: Boolean(row.isSubagent),
        subagentTypeName: String(row.subagentTypeName || "").trim(),
        workspace: workspaceHint(value),
      });
    }
    return composers.filter((item) => item.composerId);
  } finally {
    db.close();
  }
}

function findComposer(composerId) {
  if (!composerId) return null;
  const db = openStateDb();
  try {
    const row = db
      .prepare(
        "SELECT composerId, isSubagent, subagentTypeName, value FROM composerHeaders WHERE composerId = ?"
      )
      .get(String(composerId));
    if (!row) return null;
    let value = {};
    try {
      value = JSON.parse(row.value || "{}");
    } catch {
      value = {};
    }
    return {
      composerId: String(row.composerId),
      name: String(value.name || "").trim(),
      isSubagent: Boolean(row.isSubagent),
      subagentTypeName: String(row.subagentTypeName || "").trim(),
      workspace: workspaceHint(value),
    };
  } finally {
    db.close();
  }
}

module.exports = {
  readAccessToken,
  decodeJwtPayload,
  loadComposers,
  findComposer,
};

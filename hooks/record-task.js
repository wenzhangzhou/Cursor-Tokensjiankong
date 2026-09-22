"use strict";

const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "..", "data");
const OUT = path.join(DATA, "task-events.jsonl");

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    const chunks = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
    setTimeout(finish, 7000);
  });
}

function titleFromPayload(payload) {
  const direct = payload.title || payload.conversation_title || payload.composer_name || payload.name;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  return "";
}

function tokensFromPayload(payload) {
  const usage = payload.tokenUsage || payload.token_usage || payload.usage || null;
  if (!usage || typeof usage !== "object") return null;
  const pick = (key) => (Number.isFinite(Number(usage[key])) ? Number(usage[key]) : null);
  const tokens = {
    input: pick("inputTokens"),
    output: pick("outputTokens"),
    cacheRead: pick("cacheReadTokens"),
    cacheWrite: pick("cacheWriteTokens"),
  };
  if (Object.values(tokens).every((value) => value == null)) return null;
  return tokens;
}

async function main() {
  let raw = "";
  try {
    raw = await readStdin();
  } catch {
    raw = "";
  }
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }

  const conversationId = String(payload.conversation_id || payload.session_id || payload.composerId || "");
  let lookedUp = null;
  if (conversationId) {
    try {
      lookedUp = require("../lib/cursor-db").findComposer(conversationId);
    } catch {
      lookedUp = null;
    }
  }

  const title = titleFromPayload(payload) || (lookedUp && lookedUp.name) || (lookedUp && lookedUp.subagentTypeName) || "未命名会话";
  const roots = Array.isArray(payload.workspace_roots) ? payload.workspace_roots : [];
  const workspace = String(roots[0] || (lookedUp && lookedUp.workspace) || "");
  const row = {
    at: new Date().toISOString(),
    hook: String(payload.hook_event_name || ""),
    conversationId,
    sessionId: String(payload.session_id || ""),
    title,
    workspace,
    reason: String(payload.reason || payload.status || ""),
    isSubagent: Boolean(lookedUp && lookedUp.isSubagent),
    tokens: tokensFromPayload(payload),
  };

  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.appendFileSync(OUT, JSON.stringify(row) + "\n", "utf8");
  } catch {
    /* never block the agent */
  }
  process.stdout.write("{}\n");
}

main()
  .catch(() => {
    process.stdout.write("{}\n");
  })
  .finally(() => {
    process.exit(0);
  });

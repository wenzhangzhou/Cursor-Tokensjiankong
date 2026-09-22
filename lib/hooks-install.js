"use strict";

const fs = require("fs");
const path = require("path");

function hooksFile() {
  return path.join(process.env.USERPROFILE || "", ".cursor", "hooks.json");
}

function commandFor(scriptPath) {
  const node = "C:\\Program Files\\nodejs\\node.exe";
  return '"' + node + '" "' + scriptPath + '"';
}

function ensureHooks(scriptPath) {
  const file = hooksFile();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  let doc = { version: 1, hooks: {} };
  if (fs.existsSync(file)) {
    try {
      doc = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      const backup = file + ".bak-" + Date.now();
      fs.copyFileSync(file, backup);
      doc = { version: 1, hooks: {} };
    }
  }
  if (!doc || typeof doc !== "object") doc = { version: 1, hooks: {} };
  if (!doc.hooks || typeof doc.hooks !== "object") doc.hooks = {};
  const command = commandFor(scriptPath);
  const events = ["stop", "sessionEnd"];
  let changed = false;
  for (const event of events) {
    const list = Array.isArray(doc.hooks[event]) ? doc.hooks[event] : [];
    const exists = list.some((item) => item && String(item.command || "").includes("record-task.js"));
    if (!exists) {
      list.push({ command, timeout: 8 });
      doc.hooks[event] = list;
      changed = true;
    }
  }
  if (changed || !fs.existsSync(file)) {
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, file);
  }
  return { file, changed, command };
}

module.exports = { ensureHooks };

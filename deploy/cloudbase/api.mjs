import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const bin = path.join(process.env.APPDATA, "npm", "node_modules", "@cloudbase", "cli", "bin", "tcb");
const [service, action, bodyFile, envId = "eastern-hare-d7gpz96umb56910e4"] = process.argv.slice(2);

const args = ["api", service, action];
if (envId !== "-") args.push("-e", envId);
if (bodyFile && bodyFile !== "-") {
  const raw = fs.readFileSync(bodyFile, "utf8").replace(/^\uFEFF/, "");
  const body = JSON.parse(raw);
  if (envId !== "-") body.EnvId = body.EnvId || envId;
  args.push("--body", JSON.stringify(body));
}
args.push("--json");

console.log("$ tcb " + args.map((a) => (a.startsWith("{") ? "<json>" : a)).join(" "));
const r = spawnSync(process.execPath, [bin, ...args], { stdio: "inherit", encoding: "utf8" });
console.log("\nexit:", r.status);
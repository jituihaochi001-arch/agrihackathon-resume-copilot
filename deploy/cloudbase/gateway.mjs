import { spawnSync } from "node:child_process";
import path from "node:path";

const bin = path.join(process.env.APPDATA, "npm", "node_modules", "@cloudbase", "cli", "bin", "tcb");
const envId = "eastern-hare-d7gpz96umb56910e4";

function call(action, body) {
  const args = ["api", "tcb", action, "--body", JSON.stringify(body), "--json"];
  const masked = args.map((a) => (a.startsWith("{") ? "<json>" : a));
  console.log("\n$ tcb " + masked.join(" "));
  const r = spawnSync(process.execPath, [bin, ...args], { stdio: "inherit", encoding: "utf8" });
  console.log("exit:", r.status);
}

const action = process.argv[2] || "create";
const routePath = process.argv[3] || "/";
const name = process.argv[4] || "rp";

if (action === "list") {
  call("DescribeCloudBaseGWAPI", { ServiceId: envId, EnableUnion: true });
} else {
  call("CreateCloudBaseGWAPI", {
    Type: 1,
    Path: routePath,
    Name: name,
    ServiceId: envId,
    EnableUnion: true,
  });
}
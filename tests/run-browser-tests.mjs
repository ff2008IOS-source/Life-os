import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const preload = fileURLToPath(new URL("./test-clock.mjs", import.meta.url));
const result = spawnSync(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${preload}`]
        .filter(Boolean)
        .join(" "),
    },
  },
);
process.exit(result.status ?? 1);

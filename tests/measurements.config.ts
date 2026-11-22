import base from "../playwright.config";
import { resolve } from "node:path";
const servers = Array.isArray(base.webServer)
  ? base.webServer
  : [base.webServer!];
const config = {
  ...base,
  testDir: "./measurements",
  timeout: 90000,
  webServer: servers.map((server) => ({
    ...server,
    cwd: resolve(import.meta.dirname, ".."),
  })),
};

export default config;

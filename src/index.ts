#!/usr/bin/env node

import { init } from "./commands/init.js";
import { remove } from "./commands/remove.js";

const args = process.argv.slice(2);
const command = args[0] ?? "init";

switch (command) {
  case "init":
    init(args.slice(1)).catch((err) => {
      console.error(err.message ?? err);
      process.exit(1);
    });
    break;
  case "remove":
    remove().catch((err) => {
      console.error(err.message ?? err);
      process.exit(1);
    });
    break;
  case "--version":
  case "-v":
    console.log("runshift 0.0.3");
    break;
  case "--help":
  case "-h":
    console.log(`
  runshift — the control plane for agents, wherever they run.

  Usage:
    npx runshift init [options]   Read your repo, generate coordination rules
    npx runshift remove           Revert the runshift install commit

  Options:
    --version, -v                 Show version
    --help, -h                    Show this help

  Init options:
    --dry-run                     Preview changes without writing files
    --branch <name>               Run on a new branch (default: relay-init)
`);
    break;
  default:
    console.error(`Unknown command: ${command}\nRun "runshift --help" for usage.`);
    process.exit(1);
}

import { execSync } from "node:child_process";
import chalk from "chalk";
import { showBanner, showCancelled } from "../ui/display.js";
import { confirm } from "../ui/prompt.js";

const amber = chalk.hex("#f5a623");
const dim = chalk.dim;

const COMMIT_GREP = "install runshift agent governance rules";

export async function remove(): Promise<void> {
  showBanner();

  // ── Find the most recent runshift commit ──────────────────────────
  let logLine: string;
  try {
    logLine = execSync(
      `git log --oneline --grep="${COMMIT_GREP}" -1 --format="%H %s %ad" --date=short`,
      { stdio: "pipe" },
    )
      .toString()
      .trim();
  } catch {
    console.log(amber("  no runshift commit found in this repository.\n"));
    return;
  }

  if (!logLine) {
    console.log(amber("  no runshift commit found in this repository.\n"));
    return;
  }

  const spaceIdx = logLine.indexOf(" ");
  const hash = logLine.slice(0, spaceIdx);
  const rest = logLine.slice(spaceIdx + 1);

  // Split rest into message and date (date is last 10 chars: YYYY-MM-DD)
  const date = rest.slice(-10);
  const message = rest.slice(0, -11).trim();

  console.log(amber("  relay will revert commit:\n"));
  console.log(dim(`  ${hash.slice(0, 7)}`));
  console.log(dim(`  ${message}`));
  console.log(dim(`  ${date}\n`));

  const proceed = await confirm("  revert this commit? (y/n) ");
  if (!proceed) {
    showCancelled();
    return;
  }

  try {
    execSync(`git revert ${hash} --no-edit`, { stdio: "pipe" });
    console.log(amber("\n  ✓ reverted — runshift governance rules removed\n"));
  } catch (err) {
    console.log(amber("\n  revert failed."));
    console.log(dim(`  ${err instanceof Error ? err.message : err}\n`));
  }
}

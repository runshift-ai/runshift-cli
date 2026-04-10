import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import { showBanner, showCancelled } from "../ui/display.js";
import { confirm } from "../ui/prompt.js";

const amber = chalk.hex("#f5a623");
const dim = chalk.dim;

const COMMIT_GREP = "runshift agent";
const MANIFEST_PATH = ".runshift/manifest.json";

interface Manifest {
  commit_hash: string;
  files_written: string[];
  timestamp: string;
  version: string;
}

function readManifest(root: string): Manifest | null {
  try {
    const raw = fs.readFileSync(path.join(root, MANIFEST_PATH), "utf-8");
    const data = JSON.parse(raw) as Manifest;
    if (typeof data.commit_hash !== "string" || !/^[0-9a-f]{40}$/.test(data.commit_hash)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function commitExistsInHistory(hash: string): boolean {
  try {
    execFileSync("git", ["cat-file", "-t", hash], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export async function remove(): Promise<void> {
  showBanner();

  const root = process.cwd();
  const manifest = readManifest(root);

  let hash: string;
  let message: string;
  let date: string;

  if (manifest) {
    // ── Manifest-based removal ────────────────────────────────────────
    if (!commitExistsInHistory(manifest.commit_hash)) {
      console.log(amber("  manifest references a commit that no longer exists in history.\n"));
      return;
    }

    hash = manifest.commit_hash;

    // Get commit message and date for display
    try {
      const logLine = execFileSync(
        "git", ["log", "-1", "--format=%s %ad", "--date=short", hash],
        { stdio: "pipe" },
      )
        .toString()
        .trim();
      date = logLine.slice(-10);
      message = logLine.slice(0, -11).trim();
    } catch {
      message = "(could not read commit message)";
      date = manifest.timestamp.slice(0, 10);
    }
  } else {
    // ── Fallback: commit message matching ─────────────────────────────
    console.log(amber("  ⚠ No runshift manifest found. Falling back to commit message matching — verify the revert target before confirming.\n"));

    let logLine: string;
    try {
      logLine = execFileSync(
        "git", ["log", "--oneline", "--grep", COMMIT_GREP, "-1", "--format=%H %s %ad", "--date=short"],
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
    hash = logLine.slice(0, spaceIdx);

    if (!/^[0-9a-f]{40}$/.test(hash)) {
      console.log(amber("  could not parse commit hash.\n"));
      return;
    }

    const rest = logLine.slice(spaceIdx + 1);
    date = rest.slice(-10);
    message = rest.slice(0, -11).trim();
  }

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
    execFileSync("git", ["revert", hash, "--no-edit"], { stdio: "pipe" });
    console.log(amber("\n  ✓ reverted — runshift coordination rules removed\n"));

    // Clean up manifest after successful revert
    try {
      fs.unlinkSync(path.join(root, MANIFEST_PATH));
      // Remove .runshift dir if empty
      const dir = path.join(root, ".runshift");
      if (fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
      }
    } catch {
      // Non-fatal — manifest may already be gone from the revert
    }
  } catch (err) {
    console.log(amber("\n  revert failed."));
    console.log(dim(`  ${err instanceof Error ? err.message : err}\n`));
  }
}

import chalk from "chalk";
import figlet from "figlet";
import type { Findings, GeneratedFile, RepoContext } from "../types.js";

const amber = chalk.hex("#f5a623");
const muted = chalk.hex("#6b6b7b");
const dim = chalk.dim;
const divider = muted("  " + "─".repeat(45));

export function showBanner(): void {
  const banner = figlet.textSync("runshift", {
    font: "Standard",
    horizontalLayout: "default",
  });
  console.log(amber(banner));
  console.log(muted("  v0.0.3"));
  console.log(muted("  the control plane for agents, wherever they run."));
  console.log(dim("  usage: npx runshift init [--dry-run] [--branch <name>]\n"));
  console.log(divider + "\n");
}

export function showNotGitRepo(): void {
  console.log(amber("  this directory is not a git repository."));
  console.log(dim("  run runshift init from a project root with git initialized.\n"));
}

export function showDirtyWarning(): void {
  console.log(muted("  ⚠ uncommitted changes detected\n"));
}

export function showBranchInfo(branch: string): void {
  console.log(dim(`  on branch ${amber(branch)}\n`));
}

export function showScanResults(context: RepoContext): void {
  console.log(amber("  relay scanned your repository:\n"));

  const deps: Record<string, string> = {
    ...context.packageJson.dependencies,
    ...context.packageJson.devDependencies,
  };

  const detections: string[] = [];

  if (context.packageJson.name) {
    const stack: string[] = [];
    if (deps["next"]) stack.push("Next.js");
    if (deps["@supabase/supabase-js"] || deps["@supabase/ssr"]) stack.push("Supabase");
    if (deps["tailwindcss"]) stack.push("Tailwind");
    if (deps["prisma"] || deps["@prisma/client"]) stack.push("Prisma");
    if (deps["drizzle-orm"]) stack.push("Drizzle");
    if (deps["stripe"]) stack.push("Stripe");
    const label = stack.length > 0 ? stack.join(", ") + " detected" : "detected";
    detections.push(`package.json — ${label}`);
  }

  if (context.envKeys.length > 0) {
    detections.push(`.env.example — ${context.envKeys.length} environment variable${context.envKeys.length === 1 ? "" : "s"} found`);
  }

  if (context.migrationCount > 0) {
    detections.push(`supabase/migrations/ — ${context.migrationCount} migration file${context.migrationCount === 1 ? "" : "s"} found`);
  }

  const existingRuleKeys = Object.keys(context.existingRules);
  const protectedSet = new Set(context.protectedPaths);
  const cursorRules = existingRuleKeys.filter((k) => k.startsWith(".cursor/rules/"));
  if (cursorRules.length > 0) {
    const protectedCount = cursorRules.filter((k) => protectedSet.has(k)).length;
    const suffix = protectedCount > 0 ? ` (${protectedCount} protected)` : "";
    detections.push(`.cursor/rules/ — ${cursorRules.length} existing file${cursorRules.length === 1 ? "" : "s"} detected${suffix}`);
  }

  if (existingRuleKeys.includes("CLAUDE.md")) {
    const claudeProtected = protectedSet.has("CLAUDE.md") ? " (protected — human-written)" : "";
    detections.push(`existing CLAUDE.md detected${claudeProtected}`);
  }

  if (context.tsconfig) {
    detections.push("tsconfig.json detected");
  }

  const configCount = Object.keys(context.configFiles).length;
  if (configCount > 0) {
    detections.push(`${configCount} config file${configCount === 1 ? "" : "s"} found`);
  }

  for (const d of detections) {
    console.log(dim("  ✓ ") + d);
  }
  console.log();
}

export function showFindings(findings: Findings): void {
  const sections: [string, string[]][] = [
    ["blast radius", findings.blastRadius],
    ["security gaps", findings.securityGaps],
    ["agent failure patterns", findings.agentFailurePatterns],
    ["parallelization boundaries", findings.parallelizationBoundaries],
    ["deprecated patterns", findings.deprecatedPatterns],
  ];

  const hasFindings = sections.some(([, items]) => items.length > 0);
  if (!hasFindings) return;

  console.log(amber("  relay found issues in your codebase:\n"));

  for (const [title, items] of sections) {
    if (items.length === 0) continue;
    console.log(amber(`  ${title}`));
    for (const item of items) {
      console.log(dim(`  → ${item}`));
    }
    console.log();
  }
}

export function showFileList(files: GeneratedFile[]): void {
  console.log(amber(`  relay will write ${files.length} file${files.length === 1 ? "" : "s"}:\n`));
  for (const file of files) {
    const prefix = file.action === "create" ? amber("+") : amber("~");
    const action = file.action === "create" ? dim("(create)") : dim("(update — existing file)");
    console.log(`  ${prefix} ${file.path}  ${action}`);
  }
  console.log(dim("\n  + = create, ~ = update existing file\n"));
}

export function showSelectedFiles(allFiles: GeneratedFile[], selectedPaths: string[]): void {
  const selected = new Set(selectedPaths);
  console.log(amber("  relay understood:\n"));
  for (const file of allFiles) {
    if (selected.has(file.path)) {
      console.log(dim("  ✓ ") + file.path + dim(" (included)"));
    } else {
      console.log(dim("  ✗ ") + muted(file.path) + dim(" (excluded)"));
    }
  }
  console.log();
}

export function showWriting(filePath: string): void {
  console.log(dim("  ✓ ") + filePath);
}

export function showCommit(): void {
  console.log(dim("  ✓ ") + "committed");
}

export function showProtectedFiles(protectedPaths: string[]): void {
  if (protectedPaths.length === 0) return;
  console.log();
  console.log(amber("  relay preserved your existing files:"));
  for (const p of protectedPaths) {
    console.log(dim(`  ~ ${p} — human-written, not overwritten`));
  }
  console.log(dim("  run npx runshift update to review suggested changes.\n"));
}

export function showSummary(summary: string): void {
  console.log(muted(`  ${summary.replace(/\n/g, "\n  ")}\n`));
}

export function showSuccess(): void {
  console.log("\n" + divider + "\n");
  console.log(amber("  ✓ relay is installed in your development workflow\n"));
  console.log(muted("  next steps:"));
  console.log(dim("  → open Claude Code and type /validate to run your first check"));
  console.log(dim("  → type /runshift-update to refresh rules as your stack evolves\n"));
  console.log(muted("  connect to the runshift control plane: ") + amber("runshift.ai"));
  console.log("\n" + divider + "\n");
}

export function showDataPolicy(): void {
  console.log(amber("  relay will send to runshift.ai:\n"));
  console.log(dim("  ✓ package.json (dependencies and scripts only)"));
  console.log(dim("  ✓ directory structure (top 2 levels, folder names only)"));
  console.log(dim("  ✓ .env.example (key names only — values are never read)"));
  console.log(dim("  ✓ existing CLAUDE.md (if present)"));
  console.log(dim("  ✓ existing .cursor/rules/ (if present)"));
  console.log(dim("  ✓ migration file names (no file contents)"));
  console.log(dim("\n  no source code is sent."));
  console.log(dim("  no secret values are ever read."));
}

export function showDryRunComplete(): void {
  console.log("\n" + divider + "\n");
  console.log(amber("  dry run complete — no files written."));
  console.log(dim("  run npx runshift init to install.\n"));
  console.log(divider + "\n");
}

export function showCancelled(): void {
  console.log();
  console.log(amber("  no changes made."));
  console.log(dim("  run npx runshift init when you're ready."));
  console.log();
  console.log(divider + "\n");
}

export function showError(type: "network" | "rate-limit" | "validation" | "server", message?: string): void {
  console.log();
  switch (type) {
    case "network":
      console.log(amber("  could not reach relay."));
      console.log(dim("  check your connection and try again.\n"));
      break;
    case "rate-limit":
      console.log(amber("  relay rate limit reached — try again in 1 hour.\n"));
      break;
    case "validation":
      console.log(amber("  relay could not read this repository."));
      if (message) console.log(dim(`  ${message}\n`));
      break;
    case "server":
      console.log(amber("  relay encountered an error — try again or visit runshift.ai."));
      if (message) console.log(dim(`  ${message}\n`));
      break;
  }
}

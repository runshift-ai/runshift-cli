import ora from "ora";
import { exec, execSync } from "node:child_process";
import { collectRepoContext, addFileToContext } from "../context/collector.js";
import { getGitState } from "../context/git.js";
import {
  showBanner,
  showNotGitRepo,
  showDirtyWarning,
  showBranchInfo,
  showScanResults,
  showDataPolicy,
  showFindings,
  showFileList,
  showSelectedFiles,
  showProtectedFiles,
  showSummary,
  showSuccess,
  showDryRunComplete,
  showCancelled,
  showError,
} from "../ui/display.js";
import { confirm, promptChoice, promptFilePath, promptFileSelection, promptPreview } from "../ui/prompt.js";
import { writeFiles, commitFiles } from "../writer.js";
import type { InitResponse } from "../types.js";

const IS_DEV = process.env.RUNSHIFT_DEV === "true";

const API_URL = IS_DEV
  ? "http://localhost:3000/api/cli/init"
  : "https://runshift.ai/api/cli/init";

const BASE_URL = IS_DEV
  ? "http://localhost:3000"
  : "https://runshift.ai";

const TIMEOUT_MS = 180_000;

interface InitFlags {
  dryRun: boolean;
  branch: string | null;
  help: boolean;
}

function parseFlags(args: string[]): InitFlags {
  const flags: InitFlags = { dryRun: false, branch: null, help: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg === "--branch") {
      const next = args[i + 1];
      flags.branch = next && !next.startsWith("--") ? next : "relay-init";
      if (next && !next.startsWith("--")) i++;
    } else if (arg === "--help") {
      flags.help = true;
    }
  }

  return flags;
}

function showInitHelp(): void {
  console.log(`
  npx runshift init [options]

  options:
    --dry-run        preview changes without writing files
    --branch <name>  run on a new branch (default: relay-init)
    --help           show this help
`);
}

export async function init(args: string[] = []): Promise<void> {
  const flags = parseFlags(args);

  if (flags.help) {
    showInitHelp();
    return;
  }

  showBanner();

  // ── 1. Git safety ─────────────────────────────────────────────────
  const git = getGitState();

  if (!git.isGitRepo) {
    showNotGitRepo();
    process.exit(0);
  }

  showBranchInfo(git.branch);

  if (git.isDirty) {
    showDirtyWarning();
    const proceed = await confirm("  continue with uncommitted changes? (y/n) ");
    if (!proceed) {
      showCancelled();
      process.exit(0);
    }
  }

  // ── 1b. Branch flag — create and switch ───────────────────────────
  if (flags.branch) {
    try {
      execSync(`git rev-parse --verify ${flags.branch}`, { stdio: "pipe" });
      console.log(`  branch ${flags.branch} already exists.\n`);
      process.exit(1);
    } catch {
      // branch doesn't exist — good
    }

    execSync(`git checkout -b ${flags.branch}`, { stdio: "pipe" });
    console.log(`  switched to new branch ${flags.branch}\n`);
  }

  // ── 2. Collect context ────────────────────────────────────────────
  const root = process.cwd();
  const context = collectRepoContext(root);

  // ── 3. Show scan results + protected files + data policy + prompt ─
  showScanResults(context);
  showProtectedFiles(context.protectedPaths);
  showDataPolicy();

  let choice = await promptChoice("  proceed? [y] add more files? [a] cancel? [n] ");

  while (choice === "a") {
    const filePath = await promptFilePath("  file path: ");
    if (filePath) {
      const added = addFileToContext(root, filePath, context);
      if (!added) {
        console.log(`  could not read ${filePath}\n`);
      }
    }
    showScanResults(context);
    showDataPolicy();
    choice = await promptChoice("  proceed? [y] add more files? [a] cancel? [n] ");
  }

  if (choice === "n") {
    showCancelled();
    process.exit(0);
  }

  // ── 4. Call API ───────────────────────────────────────────────────
  const spinner = ora({
    text: "relay is reading your repository...",
    color: "yellow",
  }).start();

  const spinnerMessages = [
    { delay: 8000, text: "relay is analyzing your stack..." },
    { delay: 20000, text: "generating governance rules..." },
    { delay: 45000, text: "reviewing with second model..." },
    { delay: 70000, text: "synthesizing final rules..." },
  ];

  const spinnerTimeouts = spinnerMessages.map(({ delay, text }) =>
    setTimeout(() => { spinner.text = text; }, delay),
  );

  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(context),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    spinnerTimeouts.forEach((t) => clearTimeout(t));
  } catch (err) {
    spinnerTimeouts.forEach((t) => clearTimeout(t));
    spinner.stop();
    if (err instanceof Error && err.name === "AbortError") {
      showError("network", "request timed out after 180s");
    } else {
      showError("network");
    }
    process.exit(1);
  }

  if (!response.ok) {
    spinner.stop();
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const msg = (body.message ?? body.error) as string | undefined;

    if (response.status === 429) {
      showError("rate-limit");
    } else if (response.status === 400) {
      showError("validation", msg);
    } else {
      showError("server", msg);
    }
    process.exit(1);
  }

  let data: InitResponse;
  try {
    data = (await response.json()) as InitResponse;
  } catch {
    spinner.stop();
    showError("server", "invalid response from relay");
    process.exit(1);
  }

  spinner.stop();
  console.log();

  // ── 5. Show findings + file list ──────────────────────────────────
  showSummary(data.summary);
  showFindings(data.findings);
  showFileList(data.files);

  // ── 6. Preview link ───────────────────────────────────────────────
  if (data.previewId) {
    const previewUrl = `${BASE_URL}/preview/${data.previewId}`;
    const open = await promptPreview(`  preview ready — ${previewUrl}\n\n  [o] open in browser  [enter] continue  `);
    if (open) {
      exec(`open ${previewUrl}`);
    }
  }

  // ── 7. Dry run exit ───────────────────────────────────────────────
  if (flags.dryRun) {
    showDryRunComplete();
    return;
  }

  // ── 8. File selection ────────────────────────────────────────────
  const fileChoice = await promptFileSelection("  [a] accept all  [s] select files  [n] don't change anything  ");

  if (fileChoice === "n") {
    showCancelled();
    process.exit(0);
  }

  let filesToWrite = data.files;

  if (fileChoice === "a") {
    const preserved = context.protectedPaths.length;
    if (preserved > 0) {
      console.log(`\n  relay will write ${data.files.length} files.`);
      console.log(`  ${preserved} file${preserved === 1 ? " was" : "s were"} preserved (human-written).\n`);
    } else {
      console.log(`\n  relay will write all ${data.files.length} files.\n`);
    }
    const acceptConfirm = await confirm("  confirm? (y/n) ");
    if (!acceptConfirm) {
      showCancelled();
      process.exit(0);
    }
  } else if (fileChoice === "s") {
    console.log("\n  which files do you want? you can say things like:");
    console.log("  'all except CLAUDE.md'");
    console.log("  'only the cursor rules'");
    console.log("  'just core.mdc and worktrees'\n");

    const instruction = await promptFilePath("  → ");

    const selectUrl = `${BASE_URL}/api/cli/select`;
    let selectedPaths: string[];

    try {
      const selectRes = await fetch(selectUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: data.files.map((f) => f.path),
          instruction,
        }),
      });

      if (!selectRes.ok) {
        showError("server", "file selection failed");
        process.exit(1);
      }

      const selectData = (await selectRes.json()) as { selectedPaths: string[] };
      selectedPaths = selectData.selectedPaths;
    } catch {
      showError("network");
      process.exit(1);
    }

    filesToWrite = data.files.filter((f) => selectedPaths.includes(f.path));

    showSelectedFiles(data.files, selectedPaths);
    console.log(`  relay will write ${filesToWrite.length} of ${data.files.length} files.\n`);

    const selectConfirm = await confirm("  confirm? (y/n) ");
    if (!selectConfirm) {
      showCancelled();
      process.exit(0);
    }
  }

  // ── 9. Re-check git before writing ────────────────────────────────
  const gitNow = getGitState();
  if (gitNow.isDirty && !git.isDirty) {
    const proceed = await confirm("  working tree changed since scan — continue? (y/n) ");
    if (!proceed) {
      showCancelled();
      process.exit(0);
    }
  }

  // ── 10. Write + commit ────────────────────────────────────────────
  console.log();
  writeFiles(root, filesToWrite);
  console.log();

  const committed = commitFiles(root, filesToWrite);
  if (!committed) {
    console.log("  ⚠ files written but git commit failed\n");
  }

  // ── 11. Success ───────────────────────────────────────────────────
  showSuccess();
}

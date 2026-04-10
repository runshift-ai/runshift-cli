import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import type { GeneratedFile } from "./types.js";
import { showWriting, showCommit } from "./ui/display.js";

const DENIED_BASENAMES = new Set([
  ".bashrc", ".zshrc", ".profile", ".bash_profile", ".bash_login",
]);

const DENIED_ROOT_FILES = new Set(["package.json", "Makefile"]);

function isDeniedPath(resolvedPath: string, resolvedRoot: string): boolean {
  const relative = path.relative(resolvedRoot, resolvedPath);
  const segments = relative.split(path.sep);

  // .git/** — git internals (hooks, objects, config, etc.)
  if (segments.includes(".git")) return true;

  // .github/** — CI/CD workflows, Actions configs, Dependabot rules
  if (segments.includes(".github")) return true;

  // Shell profiles in any directory
  const basename = path.basename(resolvedPath);
  if (DENIED_BASENAMES.has(basename)) return true;

  // Root-only sensitive files
  if (segments.length === 1 && DENIED_ROOT_FILES.has(segments[0])) return true;

  return false;
}

function resolveReal(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    // File doesn't exist yet — resolve the parent directory and reconstruct
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const realDir = fs.realpathSync(dir);
    return path.join(realDir, base);
  }
}

export function writeFiles(root: string, files: GeneratedFile[]): void {
  const resolvedRoot = resolveReal(path.resolve(root));

  for (const file of files) {
    const fullPath = path.resolve(root, file.path);

    if (!fullPath.startsWith(resolvedRoot + path.sep) && fullPath !== resolvedRoot) {
      throw new Error(`path traversal blocked: ${file.path}`);
    }

    // Create parent dirs before resolving real path (new files need parents to exist)
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });

    // Resolve symlinks and re-check containment
    const realPath = resolveReal(fullPath);
    if (!realPath.startsWith(resolvedRoot + path.sep) && realPath !== resolvedRoot) {
      throw new Error(`Resolved path escapes repository root: ${file.path}`);
    }

    // Denylist check
    if (isDeniedPath(realPath, resolvedRoot)) {
      throw new Error(`Writer: refusing to write to sensitive path: ${realPath}`);
    }

    fs.writeFileSync(realPath, file.content, "utf-8");
    showWriting(file.path);
  }
}

export function commitFiles(root: string, files: GeneratedFile[]): boolean {
  try {
    const filePaths = files.map((f) => f.path);

    const addResult = spawnSync("git", ["add", "--", ...filePaths], {
      cwd: root,
      stdio: "pipe",
    });

    if (addResult.status !== 0) return false;

    execFileSync(
      "git", ["commit", "-m", "chore: install runshift agent coordination rules"],
      { cwd: root, stdio: "pipe" },
    );

    showCommit();
    return true;
  } catch {
    return false;
  }
}

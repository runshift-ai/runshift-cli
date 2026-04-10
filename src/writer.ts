import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import type { GeneratedFile } from "./types.js";
import { showWriting, showCommit } from "./ui/display.js";

export function writeFiles(root: string, files: GeneratedFile[]): void {
  const resolvedRoot = path.resolve(root);

  for (const file of files) {
    const fullPath = path.resolve(root, file.path);

    if (!fullPath.startsWith(resolvedRoot + path.sep) && fullPath !== resolvedRoot) {
      throw new Error(`path traversal blocked: ${file.path}`);
    }

    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, file.content, "utf-8");
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

    execSync(
      'git commit -m "chore: install runshift agent coordination rules"',
      { cwd: root, stdio: "pipe" },
    );

    showCommit();
    return true;
  } catch {
    return false;
  }
}

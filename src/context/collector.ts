import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import type { RepoContext } from "../types.js";
import { getGitState } from "./git.js";

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", ".next", ".vercel", ".turbo",
  "__pycache__", ".cache", "coverage", ".nyc_output", "build",
]);

const CONFIG_PATTERNS = [
  "next.config.ts", "next.config.js", "next.config.mjs",
  "tailwind.config.ts", "tailwind.config.js",
  "supabase/config.toml",
  "vercel.json",
  "prisma/schema.prisma",
  "drizzle.config.ts",
  ".eslintrc.json", ".eslintrc.js", "eslint.config.js", "eslint.config.mjs",
  ".prettierrc", ".prettierrc.json",
  "jest.config.ts", "jest.config.js",
  "vitest.config.ts", "vitest.config.js",
  "playwright.config.ts",
];

function readJsonSafe(filePath: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function getDirectoryTree(root: string, maxDepth: number = 2): string[] {
  const entries: string[] = [];

  function walk(dir: string, depth: number, prefix: string) {
    if (depth > maxDepth) return;

    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const item of items) {
      if (IGNORE_DIRS.has(item.name)) continue;
      if (item.name.startsWith(".") && depth === 0 && item.isDirectory()) continue;

      const relative = prefix ? `${prefix}/${item.name}` : item.name;

      if (item.isDirectory()) {
        entries.push(`${relative}/`);
        walk(path.join(dir, item.name), depth + 1, relative);
      } else if (depth <= 1) {
        entries.push(relative);
      }
    }
  }

  walk(root, 0, "");
  return entries;
}

function getRootConfigs(root: string): string[] {
  const configPatterns = [
    /^\..*rc$/,
    /^\..*rc\.json$/,
    /^\..*rc\.js$/,
    /^\..*rc\.yml$/,
    /^\..*rc\.yaml$/,
    /\.config\.(ts|js|mjs|cjs)$/,
    /^tsconfig.*\.json$/,
    /^docker-compose.*\.ya?ml$/,
    /^Dockerfile/,
    /^Makefile$/,
    /^\.env\.example$/,
  ];

  try {
    const items = fs.readdirSync(root);
    return items.filter((item) => {
      return configPatterns.some((p) => p.test(item));
    });
  } catch {
    return [];
  }
}

function getProtectedPaths(root: string, existingRules: Record<string, string>): string[] {
  const protectedPaths: string[] = [];

  for (const filePath of Object.keys(existingRules)) {
    // CLAUDE.md is always protected regardless of git history
    if (filePath === "CLAUDE.md") {
      protectedPaths.push(filePath);
      continue;
    }

    try {
      const lastCommitMsg = execSync(
        `git log --follow -1 --pretty=format:"%s" -- "${filePath}"`,
        { cwd: root, stdio: "pipe" },
      ).toString().trim();

      if (!lastCommitMsg) {
        // Not in git → human created → protect
        protectedPaths.push(filePath);
        continue;
      }

      const isRelay =
        lastCommitMsg.includes("install runshift agent governance rules") ||
        lastCommitMsg.includes("runshift update");

      if (!isRelay) {
        // Last commit was by a human → protect
        protectedPaths.push(filePath);
      }
    } catch {
      // git log failed → protect to be safe
      protectedPaths.push(filePath);
    }
  }

  return protectedPaths;
}

export function collectRepoContext(root: string): RepoContext {
  // ── package.json ──
  const pkgJson = readJsonSafe(path.join(root, "package.json"));
  const packageJson = pkgJson
    ? {
        name: pkgJson.name as string | undefined,
        description: pkgJson.description as string | undefined,
        dependencies: (pkgJson.dependencies ?? {}) as Record<string, string>,
        devDependencies: (pkgJson.devDependencies ?? {}) as Record<string, string>,
        scripts: (pkgJson.scripts ?? {}) as Record<string, string>,
        workspaces: pkgJson.workspaces as string[] | { packages: string[] } | undefined,
      }
    : { dependencies: {}, devDependencies: {}, scripts: {} };

  // ── tsconfig.json ──
  const tsconfig = readJsonSafe(path.join(root, "tsconfig.json"));

  // ── Directory tree ──
  const directoryTree = getDirectoryTree(root);

  // ── .env.example — key names only ──
  const envKeys: string[] = [];
  const envContent = readFileSafe(path.join(root, ".env.example"));
  if (envContent) {
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const key = trimmed.split("=")[0].trim();
        if (key) envKeys.push(key);
      }
    }
  }

  // ── Config files ──
  const configFiles: Record<string, string> = {};
  for (const pattern of CONFIG_PATTERNS) {
    const fullPath = path.join(root, pattern);
    const content = readFileSafe(fullPath);
    if (content) {
      // Cap config file content at 5000 chars
      configFiles[pattern] = content.slice(0, 5000);
    }
  }

  // ── Existing rules ──
  const existingRules: Record<string, string> = {};

  // .cursor/rules/
  const cursorRulesDir = path.join(root, ".cursor", "rules");
  try {
    const ruleFiles = fs.readdirSync(cursorRulesDir);
    for (const file of ruleFiles) {
      const content = readFileSafe(path.join(cursorRulesDir, file));
      if (content) {
        existingRules[`.cursor/rules/${file}`] = content;
      }
    }
  } catch {
    // no existing rules
  }

  // CLAUDE.md
  const claudeMd = readFileSafe(path.join(root, "CLAUDE.md"));
  if (claudeMd) {
    existingRules["CLAUDE.md"] = claudeMd;
  }

  // ── Protected paths ──
  const protectedPaths = getProtectedPaths(root, existingRules);

  // ── Migrations ──
  let migrationCount = 0;
  let migrationNames: string[] = [];
  const migrationsDir = path.join(root, "supabase", "migrations");
  try {
    const migFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
    migrationCount = migFiles.length;
    migrationNames = migFiles;
  } catch {
    // no migrations
  }

  // ── Root configs ──
  const rootConfigs = getRootConfigs(root);

  // ── Git state ──
  const git = getGitState();
  const gitState = git.isGitRepo ? { branch: git.branch, isDirty: git.isDirty } : null;

  return {
    packageJson,
    tsconfig,
    directoryTree,
    envKeys,
    configFiles,
    existingRules,
    migrationCount,
    migrationNames,
    rootConfigs,
    protectedPaths,
    gitState,
  };
}

export function addFileToContext(root: string, filePath: string, context: RepoContext): boolean {
  const fullPath = path.resolve(root, filePath);
  const content = readFileSafe(fullPath);
  if (!content) return false;
  context.configFiles[filePath] = content.slice(0, 5000);
  return true;
}

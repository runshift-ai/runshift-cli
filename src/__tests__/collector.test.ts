import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import { collectRepoContext } from "../context/collector.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  accessSync: vi.fn(() => { throw new Error("ENOENT"); }),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(() => ({ status: 0, stdout: { toString: () => "" } })),
  execFileSync: vi.fn(),
}));

vi.mock("../context/git.js", () => ({
  getGitState: vi.fn().mockReturnValue({
    isGitRepo: true,
    branch: "main",
    isDirty: false,
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROOT = "/fake/root";

/** Minimal readFileSync mock: returns valid JSON for package.json, throws for everything else. */
function withPackageJson(extraOverrides?: (p: string) => string | null) {
  vi.mocked(fs.readFileSync).mockImplementation((p) => {
    const path = String(p);
    const extra = extraOverrides?.(path);
    if (extra !== undefined && extra !== null) return extra as any;
    if (path.endsWith("package.json")) {
      return JSON.stringify({ dependencies: {}, devDependencies: {}, scripts: {} }) as any;
    }
    const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    throw err;
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("collectRepoContext — data exfiltration guards", () => {
  beforeEach(() => {
    vi.mocked(fs.readdirSync).mockReturnValue([] as any);
    vi.mocked(fs.accessSync).mockImplementation(() => { throw new Error("ENOENT"); });
  });

  it("config file values are empty strings, not file contents", () => {
    // Simulate next.config.ts existing on disk
    vi.mocked(fs.accessSync).mockImplementation((p) => {
      if (String(p).includes("next.config.ts")) return undefined as any;
      throw new Error("ENOENT");
    });

    withPackageJson();

    const ctx = collectRepoContext(ROOT);

    expect(ctx.configFiles["next.config.ts"]).toBe("");
  });

  it("tsconfig sends only target, module, strict, and outDir", () => {
    const richTsconfig = {
      compilerOptions: {
        target: "ES2020",
        module: "NodeNext",
        strict: true,
        outDir: "dist",
        baseUrl: ".",              // must NOT appear in result
        paths: { "@/*": ["src/*"] }, // must NOT appear in result
        experimentalDecorators: true, // must NOT appear in result
      },
    };

    withPackageJson((p) => {
      if (p.endsWith("tsconfig.json")) return JSON.stringify(richTsconfig);
      return null as any;
    });

    const ctx = collectRepoContext(ROOT);
    const co = ctx.tsconfig?.compilerOptions as Record<string, unknown>;

    expect(co).toHaveProperty("target", "ES2020");
    expect(co).toHaveProperty("module", "NodeNext");
    expect(co).toHaveProperty("strict", true);
    expect(co).toHaveProperty("outDir", "dist");
  });

  it("tsconfig does not include baseUrl, paths, or experimentalDecorators", () => {
    const richTsconfig = {
      compilerOptions: {
        target: "ES2020",
        module: "NodeNext",
        strict: true,
        outDir: "dist",
        baseUrl: ".",
        paths: { "@/*": ["src/*"] },
        experimentalDecorators: true,
      },
    };

    withPackageJson((p) => {
      if (p.endsWith("tsconfig.json")) return JSON.stringify(richTsconfig);
      return null as any;
    });

    const ctx = collectRepoContext(ROOT);
    const co = ctx.tsconfig?.compilerOptions as Record<string, unknown>;

    expect(co).not.toHaveProperty("baseUrl");
    expect(co).not.toHaveProperty("paths");
    expect(co).not.toHaveProperty("experimentalDecorators");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFiles, commitFiles } from "../writer.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const cpMocks = vi.hoisted(() => ({
  spawnSync: vi.fn(() => ({ status: 0 as number | null })),
  execSync: vi.fn(),
}));

vi.mock("node:child_process", () => cpMocks);

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("../ui/display.js", () => ({
  showWriting: vi.fn(),
  showCommit: vi.fn(),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ROOT = "/tmp/testroot";

// ── writeFiles — path traversal protection ────────────────────────────────────

describe("writeFiles — path traversal protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws for path "../../../etc/passwd"', () => {
    expect(() =>
      writeFiles(ROOT, [{ path: "../../../etc/passwd", content: "x", action: "create" }]),
    ).toThrow("path traversal blocked");
  });

  it('throws for path "../../.bashrc"', () => {
    expect(() =>
      writeFiles(ROOT, [{ path: "../../.bashrc", content: "x", action: "create" }]),
    ).toThrow("path traversal blocked");
  });

  it("accepts a path within the root and writes the file", () => {
    expect(() =>
      writeFiles(ROOT, [{ path: "src/rules/core.mdc", content: "# rules", action: "create" }]),
    ).not.toThrow();
  });
});

// ── commitFiles — git add uses spawnSync not execSync ─────────────────────────

describe("commitFiles — git add uses spawnSync not execSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // execSync (used for git commit) succeeds by default
    cpMocks.execSync.mockReturnValue(undefined);
  });

  it("calls spawnSync with 'git' and 'add' args", () => {
    commitFiles(ROOT, [{ path: "foo.md", content: "x", action: "create" }]);

    expect(cpMocks.spawnSync).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["add"]),
      expect.any(Object),
    );
  });

  it("does not pass file paths to execSync via shell string (no 'git add' in execSync calls)", () => {
    commitFiles(ROOT, [{ path: "foo.md", content: "x", action: "create" }]);

    const addViaExec = cpMocks.execSync.mock.calls.find(
      ([cmd]: string[]) => typeof cmd === "string" && cmd.includes("git add"),
    );
    expect(addViaExec).toBeUndefined();
  });
});

// ── Dependency pinning ────────────────────────────────────────────────────────

describe("dependency pinning — runtime deps have no ^ prefix", () => {
  it("chalk, figlet, and ora are pinned to exact versions in package.json", async () => {
    // Use a relative JSON import so we don't need @types/node for fs access
    const pkg = (await import("../../package.json")) as unknown as {
      default: { dependencies: Record<string, string> };
    };
    const { dependencies: deps } = pkg.default;

    expect(deps["chalk"]).not.toMatch(/^\^/);
    expect(deps["figlet"]).not.toMatch(/^\^/);
    expect(deps["ora"]).not.toMatch(/^\^/);
  });
});

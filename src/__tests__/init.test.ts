/**
 * Tests for src/commands/init.ts — stream reader behaviour
 *
 * Setup required before running:
 *   npm install -D vitest
 *   Add vitest.config.ts:
 *     import { defineConfig } from 'vitest/config'
 *     export default defineConfig({ test: { environment: 'node' } })
 *
 * Run: npx vitest run src/__tests__/init.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Findings, GeneratedFile } from "../types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXTURE_FINDINGS: Findings = {
  blastRadius: ["src/middleware.ts — auth enforcement"],
  securityGaps: ["RLS missing on new tables"],
  agentFailurePatterns: ["Agent overwriting migrations"],
  parallelizationBoundaries: ["DB migrations are sequential"],
  deprecatedPatterns: ["localStorage use"],
};

const FIXTURE_FILES: GeneratedFile[] = [
  {
    path: ".cursor/rules/core.mdc",
    content: "---\nalwaysApply: true\n---\n# Core rules",
    action: "create",
  },
  {
    path: ".claude/commands/runshift-update.md",
    content: "# Runshift Update",
    action: "create",
  },
];

// ── Spinner stub ──────────────────────────────────────────────────────────────
// Shared reference so tests can assert on .stop() calls.

const mockSpinner = {
  start: vi.fn().mockReturnThis(),
  stop: vi.fn(),
  text: "",
};

// ── Module mocks ─────────────────────────────────────────────────────────────
// All vi.mock calls are hoisted to the top of the file by vitest.

vi.mock("ora", () => ({
  default: vi.fn(() => mockSpinner),
}));

vi.mock("../context/git.js", () => ({
  getGitState: vi.fn().mockReturnValue({
    isGitRepo: true,
    branch: "main",
    isDirty: false,
  }),
}));

vi.mock("../context/collector.js", () => ({
  collectRepoContext: vi.fn().mockReturnValue({
    packageJson: { name: "test-app" },
    tsconfig: null,
    directoryTree: ["src/"],
    envKeys: [],
    configFiles: {},
    existingRules: {},
    protectedPaths: [],
    migrationCount: 0,
    migrationNames: [],
    rootConfigs: [],
    gitState: { branch: "main", isDirty: false },
  }),
  addFileToContext: vi.fn(),
}));

vi.mock("../ui/display.js", () => ({
  showBanner: vi.fn(),
  showNotGitRepo: vi.fn(),
  showDirtyWarning: vi.fn(),
  showBranchInfo: vi.fn(),
  showScanResults: vi.fn(),
  showDataPolicy: vi.fn(),
  showFindings: vi.fn(),
  showFileList: vi.fn(),
  showSelectedFiles: vi.fn(),
  showProtectedFiles: vi.fn(),
  showSummary: vi.fn(),
  showSuccess: vi.fn(),
  showDryRunComplete: vi.fn(),
  showCancelled: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("../ui/prompt.js", () => ({
  confirm: vi.fn().mockResolvedValue(true),
  promptChoice: vi.fn().mockResolvedValue("y"),
  promptFilePath: vi.fn().mockResolvedValue(""),
  // Default: "n" so init() returns cleanly without writing files
  promptFileSelection: vi.fn().mockResolvedValue("n"),
  promptPreview: vi.fn().mockResolvedValue(false),
}));

vi.mock("../writer.js", () => ({
  writeFiles: vi.fn(),
  commitFiles: vi.fn().mockReturnValue(true),
}));

// Hoisted so mock factories and test bodies share the same references
// without needing to import from "node:child_process" in the test file.
// Hoisted so mock factories and test bodies share the same references
// without needing to import from "node:child_process" in the test file.
const cpMocks = vi.hoisted(() => ({
  exec: vi.fn(),
  execFileSync: vi.fn(),
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  // status: 0 is the only field checked in commitFiles
  spawnSync: vi.fn(() => ({ status: 0 as number | null })),
}));

vi.mock("node:child_process", () => cpMocks);

// ── Stream helpers ────────────────────────────────────────────────────────────

/** Build a Response whose body is a single ReadableStream chunk of NDJSON events. */
function makeStreamResponse(events: object[]): Response {
  const encoder = new TextEncoder();
  const body = events.map((e) => JSON.stringify(e) + "\n").join("");
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

/**
 * Build a Response whose body emits the provided raw string chunks individually.
 * Chunks may split JSON lines anywhere — the stream reader's buffer must reassemble.
 */
function makeChunkedStreamResponse(rawChunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of rawChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("init command — stream reader", () => {
  let init: (args: string[]) => Promise<void>;
  let showError: ReturnType<typeof vi.fn>;
  let showFindings: ReturnType<typeof vi.fn>;
  let showSummary: ReturnType<typeof vi.fn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Mock process.exit to throw — prevents the test process from terminating
    // and lets us assert the call after catching the thrown error.
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code ?? 0})`);
    });

    vi.stubGlobal("fetch", vi.fn());

    // Dynamically import after mocks are registered
    const display = await import("../ui/display.js");
    showError = vi.mocked(display.showError);
    showFindings = vi.mocked(display.showFindings);
    showSummary = vi.mocked(display.showSummary);

    const module = await import("../commands/init.js");
    init = module.init;

    // Reset spinner call counts from any prior test
    mockSpinner.start.mockClear();
    mockSpinner.stop.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  // ── 2. CLI assembles InitResponse correctly from out-of-order events ────────

  describe("out-of-order stream events (test 2)", () => {
    it("populates findings correctly even when files arrives first", async () => {
      const events = [
        { type: "status", text: "thinking..." },
        { type: "files", data: FIXTURE_FILES },         // before findings
        { type: "summary", data: "Rules generated." },
        { type: "findings", data: FIXTURE_FINDINGS },   // after files + summary
        { type: "previewId", data: "abc-preview-id" },
        { type: "done" },
      ];
      vi.mocked(fetch).mockResolvedValue(makeStreamResponse(events));

      await init(["--dry-run"]);

      expect(showFindings).toHaveBeenCalledWith(FIXTURE_FINDINGS);
    });

    it("populates summary correctly when summary arrives before findings", async () => {
      const events = [
        { type: "summary", data: "Great rules." },      // before findings
        { type: "findings", data: FIXTURE_FINDINGS },
        { type: "files", data: FIXTURE_FILES },
        { type: "previewId", data: "abc-id" },
        { type: "done" },
      ];
      vi.mocked(fetch).mockResolvedValue(makeStreamResponse(events));

      await init(["--dry-run"]);

      expect(showSummary).toHaveBeenCalledWith("Great rules.");
    });

    it("still has all four fields when every payload event is fully reversed", async () => {
      // previewId → files → summary → findings → done
      const events = [
        { type: "previewId", data: "early-preview" },
        { type: "files", data: FIXTURE_FILES },
        { type: "summary", data: "Reversed order summary." },
        { type: "findings", data: FIXTURE_FINDINGS },
        { type: "done" },
      ];
      vi.mocked(fetch).mockResolvedValue(makeStreamResponse(events));

      await init(["--dry-run"]);

      expect(showFindings).toHaveBeenCalledWith(FIXTURE_FINDINGS);
      expect(showSummary).toHaveBeenCalledWith("Reversed order summary.");
    });

    it("ignores unknown event types and still assembles a complete response", async () => {
      const events = [
        { type: "unknown-future-event", data: "ignored" },
        { type: "findings", data: FIXTURE_FINDINGS },
        { type: "files", data: FIXTURE_FILES },
        { type: "another-unknown", payload: 42 },
        { type: "summary", data: "Good summary." },
        { type: "previewId", data: "x-id" },
        { type: "done" },
      ];
      vi.mocked(fetch).mockResolvedValue(makeStreamResponse(events));

      await init(["--dry-run"]);

      expect(showFindings).toHaveBeenCalledWith(FIXTURE_FINDINGS);
      expect(showSummary).toHaveBeenCalledWith("Good summary.");
    });
  });

  // ── 3. Partial chunks reassembled correctly across read() calls ───────────

  describe("partial chunk reassembly (test 3)", () => {
    it("parses a findings JSON line split across two read() calls", async () => {
      const findingsLine = JSON.stringify({ type: "findings", data: FIXTURE_FINDINGS }) + "\n";
      const rest =
        JSON.stringify({ type: "files", data: FIXTURE_FILES }) +
        "\n" +
        JSON.stringify({ type: "summary", data: "Chunk test." }) +
        "\n" +
        JSON.stringify({ type: "done" }) +
        "\n";

      const splitAt = Math.floor(findingsLine.length / 2);
      const chunks = [findingsLine.slice(0, splitAt), findingsLine.slice(splitAt) + rest];

      vi.mocked(fetch).mockResolvedValue(makeChunkedStreamResponse(chunks));

      await init(["--dry-run"]);

      expect(showFindings).toHaveBeenCalledWith(FIXTURE_FINDINGS);
      expect(showSummary).toHaveBeenCalledWith("Chunk test.");
    });

    it("parses events split across many small chunks (character-at-a-time)", async () => {
      // Use minimal fixture to keep chunk count manageable
      const smallFindings: Findings = {
        blastRadius: ["a"],
        securityGaps: [],
        agentFailurePatterns: [],
        parallelizationBoundaries: [],
        deprecatedPatterns: [],
      };
      const smallFiles: GeneratedFile[] = [{ path: "a.md", content: "x", action: "create" }];

      const allLines = [
        JSON.stringify({ type: "findings", data: smallFindings }) + "\n",
        JSON.stringify({ type: "files", data: smallFiles }) + "\n",
        JSON.stringify({ type: "summary", data: "Byte test." }) + "\n",
        JSON.stringify({ type: "done" }) + "\n",
      ].join("");

      // Each character is its own ReadableStream chunk
      const chars = allLines.split("");
      vi.mocked(fetch).mockResolvedValue(makeChunkedStreamResponse(chars));

      await init(["--dry-run"]);

      expect(showFindings).toHaveBeenCalledWith(smallFindings);
      expect(showSummary).toHaveBeenCalledWith("Byte test.");
    });

    it("handles a chunk that contains multiple complete newline-delimited events", async () => {
      // Two events packed into one chunk, then the rest separately
      const chunk1 =
        JSON.stringify({ type: "findings", data: FIXTURE_FINDINGS }) +
        "\n" +
        JSON.stringify({ type: "files", data: FIXTURE_FILES }) +
        "\n";

      const chunk2 =
        JSON.stringify({ type: "summary", data: "Multi-event chunk." }) +
        "\n" +
        JSON.stringify({ type: "done" }) +
        "\n";

      vi.mocked(fetch).mockResolvedValue(makeChunkedStreamResponse([chunk1, chunk2]));

      await init(["--dry-run"]);

      expect(showFindings).toHaveBeenCalledWith(FIXTURE_FINDINGS);
      expect(showSummary).toHaveBeenCalledWith("Multi-event chunk.");
    });

    it("discards an incomplete trailing line after the done event", async () => {
      const validLines =
        JSON.stringify({ type: "findings", data: FIXTURE_FINDINGS }) +
        "\n" +
        JSON.stringify({ type: "files", data: FIXTURE_FILES }) +
        "\n" +
        JSON.stringify({ type: "summary", data: "ok" }) +
        "\n" +
        JSON.stringify({ type: "done" }) +
        "\n";

      // Append a broken JSON fragment with no trailing newline — should be ignored
      const withTrailingJunk = validLines + '{"type":"incomplete"';

      vi.mocked(fetch).mockResolvedValue(makeChunkedStreamResponse([withTrailingJunk]));

      // Should complete without error (init returns normally in --dry-run)
      await init(["--dry-run"]);

      expect(showFindings).toHaveBeenCalledWith(FIXTURE_FINDINGS);
    });

    it("skips malformed JSON lines without aborting the stream", async () => {
      const lines = [
        JSON.stringify({ type: "findings", data: FIXTURE_FINDINGS }) + "\n",
        "this is not json at all\n",                              // malformed — skipped
        JSON.stringify({ type: "files", data: FIXTURE_FILES }) + "\n",
        "{broken\n",                                               // malformed — skipped
        JSON.stringify({ type: "summary", data: "Robust." }) + "\n",
        JSON.stringify({ type: "done" }) + "\n",
      ].join("");

      vi.mocked(fetch).mockResolvedValue(makeChunkedStreamResponse([lines]));

      await init(["--dry-run"]);

      expect(showFindings).toHaveBeenCalledWith(FIXTURE_FINDINGS);
      expect(showSummary).toHaveBeenCalledWith("Robust.");
    });
  });

  // ── 4. error event mid-stream → spinner stops, showError called, process.exit(1) ──

  describe("error event handling (test 4)", () => {
    it("stops the spinner when an error event arrives mid-stream", async () => {
      vi.mocked(fetch).mockResolvedValue(
        makeStreamResponse([
          { type: "status", text: "working..." },
          { type: "findings", data: FIXTURE_FINDINGS },
          { type: "error", error: "generation failed", message: "Claude API overloaded" },
        ]),
      );

      await expect(init([])).rejects.toThrow("process.exit(1)");

      expect(mockSpinner.stop).toHaveBeenCalled();
    });

    it("calls showError with error type and message from the error event", async () => {
      vi.mocked(fetch).mockResolvedValue(
        makeStreamResponse([
          { type: "error", error: "generation failed", message: "token limit exceeded" },
        ]),
      );

      await expect(init([])).rejects.toThrow("process.exit(1)");

      expect(showError).toHaveBeenCalledWith("generation failed", "token limit exceeded");
    });

    it("calls process.exit(1) after an error event", async () => {
      vi.mocked(fetch).mockResolvedValue(
        makeStreamResponse([
          { type: "error", error: "generation failed", message: "oops" },
        ]),
      );

      await expect(init([])).rejects.toThrow("process.exit(1)");

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("calls showError before process.exit on error event", async () => {
      const callOrder: string[] = [];

      showError.mockImplementation(() => {
        callOrder.push("showError");
      });
      exitSpy.mockImplementation(() => {
        callOrder.push("exit");
        throw new Error("process.exit(1)");
      });

      vi.mocked(fetch).mockResolvedValue(
        makeStreamResponse([
          { type: "error", error: "generation failed", message: "crash" },
        ]),
      );

      await expect(init([])).rejects.toThrow("process.exit(1)");

      expect(callOrder).toEqual(["showError", "exit"]);
    });
  });

  // ── spinner lifecycle ─────────────────────────────────────────────────────
  // The CLI maintains a single `activeSpinner` reference.  A new ora spinner is
  // created and started on each `status` event.  It is stopped when the next
  // event arrives (status, step, or done) and nulled when the stream closes.

  describe("status spinner lifecycle", () => {
    /** Minimal valid stream that reaches --dry-run exit cleanly. */
    function makeValidStream(extraEvents: object[] = []): Response {
      return makeStreamResponse([
        ...extraEvents,
        { type: "findings", data: FIXTURE_FINDINGS },
        { type: "files", data: FIXTURE_FILES },
        { type: "summary", data: "ok" },
        { type: "done" },
      ]);
    }

    it("ora is called and .start() is invoked when the first status event arrives", async () => {
      const { default: ora } = await import("ora");

      vi.mocked(fetch).mockResolvedValue(
        makeValidStream([{ type: "status", text: "working..." }]),
      );

      await init(["--dry-run"]);

      expect(ora).toHaveBeenCalled();
      expect(mockSpinner.start).toHaveBeenCalled();
    });

    it("activeSpinner.stop() is called when a second status event arrives", async () => {
      vi.mocked(fetch).mockResolvedValue(
        makeValidStream([
          { type: "status", text: "first status" },
          { type: "status", text: "second status" },
        ]),
      );

      await init(["--dry-run"]);

      // Two status events → two .start() calls; first spinner stopped before second starts
      expect(mockSpinner.start).toHaveBeenCalledTimes(2);
      // stop() called: once before second status, once after done (post-loop cleanup)
      expect(mockSpinner.stop).toHaveBeenCalledTimes(2);
    });

    it("activeSpinner.stop() is called after the stream closes (post-loop cleanup)", async () => {
      vi.mocked(fetch).mockResolvedValue(
        makeValidStream([{ type: "status", text: "thinking..." }]),
      );

      await init(["--dry-run"]);

      // status → start(1); done → loop breaks → post-loop stop(1)
      expect(mockSpinner.stop).toHaveBeenCalledTimes(1);
    });

    it("step event stops activeSpinner before the label is logged", async () => {
      const callOrder: string[] = [];

      mockSpinner.stop.mockImplementation(() => {
        callOrder.push("stop");
      });
      const consoleSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        const msg = String(args[0]);
        if (msg.includes("✦")) callOrder.push("label");
      });

      vi.mocked(fetch).mockResolvedValue(
        makeValidStream([
          { type: "status", text: "thinking..." },
          { type: "step", label: "reading package.json", result: "next 14 found" },
        ]),
      );

      await init(["--dry-run"]);
      consoleSpy.mockRestore();

      // stop() must precede label console.log
      expect(callOrder.indexOf("stop")).toBeLessThan(callOrder.indexOf("label"));
    });
  });

  // ── 9. AbortError on 180s timeout handled correctly ───────────────────────

  describe("timeout / network failure (test 9)", () => {
    it('shows "request timed out after 180s" message on AbortError', async () => {
      const abortError = Object.assign(new Error("The operation was aborted"), {
        name: "AbortError",
      });
      vi.mocked(fetch).mockRejectedValue(abortError);

      await expect(init([])).rejects.toThrow("process.exit(1)");

      expect(showError).toHaveBeenCalledWith("network", "request timed out after 180s");
    });

    it("calls process.exit(1) after showError on AbortError", async () => {
      const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
      vi.mocked(fetch).mockRejectedValue(abortError);

      await expect(init([])).rejects.toThrow("process.exit(1)");

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("does not call spinner.stop() on AbortError (spinner never started before fetch throws)", async () => {
      // The AbortError is caught before any stream events are processed,
      // so activeSpinner is null and stop() is never called.
      const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
      vi.mocked(fetch).mockRejectedValue(abortError);

      await expect(init([])).rejects.toThrow("process.exit(1)");

      expect(mockSpinner.stop).not.toHaveBeenCalled();
      expect(showError).toHaveBeenCalledWith("network", "request timed out after 180s");
    });

    it('calls generic showError("network") for non-AbortError fetch failures', async () => {
      const networkError = new Error("ECONNREFUSED 127.0.0.1:3000");
      vi.mocked(fetch).mockRejectedValue(networkError);

      await expect(init([])).rejects.toThrow("process.exit(1)");

      expect(showError).toHaveBeenCalledWith("network");
      expect(showError).not.toHaveBeenCalledWith("network", "request timed out after 180s");
    });

    it("does not pass a message argument to showError for non-AbortError", async () => {
      const networkError = new Error("EHOSTUNREACH");
      vi.mocked(fetch).mockRejectedValue(networkError);

      await expect(init([])).rejects.toThrow("process.exit(1)");

      // showError called with exactly one argument, not two
      const call = showError.mock.calls[0];
      expect(call).toHaveLength(1);
      expect(call[0]).toBe("network");
    });
  });

  // ── Branch name validation — command injection ─────────────────────────────

  describe("branch name validation — command injection", () => {
    it("rejects branch name containing semicolon before execFileSync is called", async () => {
      await expect(init(["--branch", "foo;rm -rf /"])).rejects.toThrow("process.exit(1)");

      expect(cpMocks.execFileSync).not.toHaveBeenCalled();
    });

    it("rejects branch name containing backtick before execFileSync is called", async () => {
      await expect(init(["--branch", "foo`id`bar"])).rejects.toThrow("process.exit(1)");

      expect(cpMocks.execFileSync).not.toHaveBeenCalled();
    });

    it("accepts a valid branch name and proceeds past validation", async () => {
      // First execFileSync (git rev-parse) throws → branch doesn't exist → proceed
      // Second execFileSync (git checkout -b) returns normally
      cpMocks.execFileSync
        .mockImplementationOnce(() => { throw new Error("not found"); })
        .mockImplementationOnce(() => undefined as any);

      vi.mocked(fetch).mockResolvedValue(makeStreamResponse([
        { type: "findings", data: FIXTURE_FINDINGS },
        { type: "files",    data: FIXTURE_FILES },
        { type: "summary",  data: "ok" },
        { type: "done" },
      ]));

      await init(["--branch", "relay-init", "--dry-run"]);

      // Reaching this line without throwing proves the name passed the regex
      expect(exitSpy).not.toHaveBeenCalledWith(1);
    });
  });

  // ── API response validation ────────────────────────────────────────────────

  describe("API response validation", () => {
    function streamWith(filesPayload: unknown): Response {
      return makeStreamResponse([
        { type: "findings", data: FIXTURE_FINDINGS },
        { type: "summary",  data: "ok" },
        { type: "files",    data: filesPayload },
        { type: "done" },
      ]);
    }

    it("rejects a non-array files field", async () => {
      vi.mocked(fetch).mockResolvedValue(streamWith("not-an-array"));

      await expect(init([])).rejects.toThrow("process.exit(1)");

      expect(showError).toHaveBeenCalledWith("server", "incomplete response from relay");
    });

    it("rejects a file entry missing the path field", async () => {
      vi.mocked(fetch).mockResolvedValue(
        streamWith([{ content: "x", action: "create" }]),
      );

      await expect(init([])).rejects.toThrow("process.exit(1)");

      expect(showError).toHaveBeenCalledWith("server", "invalid response: file missing path or content");
    });

    it("rejects a file entry whose path contains '..'", async () => {
      vi.mocked(fetch).mockResolvedValue(
        streamWith([{ path: "../../etc/passwd", content: "x", action: "create" }]),
      );

      await expect(init([])).rejects.toThrow("process.exit(1)");

      expect(showError).toHaveBeenCalledWith(
        "server",
        expect.stringContaining("path traversal"),
      );
    });

    it("passes validation for a well-formed response and renders the file list", async () => {
      vi.mocked(fetch).mockResolvedValue(streamWith(FIXTURE_FILES));

      const { showFileList } = await import("../ui/display.js");

      await init(["--dry-run"]);

      expect(vi.mocked(showFileList)).toHaveBeenCalledWith(FIXTURE_FILES);
    });
  });

  // ── Open preview — uses spawn not exec ────────────────────────────────────

  describe("open preview — uses spawn not exec", () => {
    it("calls spawn('open', ...) when user chooses to open preview", async () => {
      const { promptPreview } = await import("../ui/prompt.js");
      vi.mocked(promptPreview).mockResolvedValueOnce(true);

      vi.mocked(fetch).mockResolvedValue(makeStreamResponse([
        { type: "findings",  data: FIXTURE_FINDINGS },
        { type: "files",     data: FIXTURE_FILES },
        { type: "summary",   data: "ok" },
        { type: "previewId", data: "abc-preview-id" },
        { type: "done" },
      ]));

      await init(["--dry-run"]);

      expect(cpMocks.spawn).toHaveBeenCalledWith(
        "open",
        [expect.stringContaining("abc-preview-id")],
        expect.objectContaining({ detached: true }),
      );
    });
  });

  // ── DEV mode warning ──────────────────────────────────────────────────────

  describe("DEV mode warning", () => {
    it("prints dev-mode warning when RUNSHIFT_DEV=true", async () => {
      const consoleSpy = vi.spyOn(console, "log");

      // IS_DEV is a module-level const — must clear cache and re-import
      // vi.stubEnv sets the env var and restores it in afterEach automatically
      vi.stubEnv("RUNSHIFT_DEV", "true");
      vi.resetModules();

      try {
        const { init: freshInit } = await import("../commands/init.js");

        // Provide a complete stream so init reaches the banner before any exit
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeStreamResponse([
          { type: "findings", data: FIXTURE_FINDINGS },
          { type: "files",    data: FIXTURE_FILES },
          { type: "summary",  data: "ok" },
          { type: "done" },
        ])));

        await freshInit(["--dry-run"]);

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("dev mode"),
        );
      } finally {
        vi.unstubAllEnvs();
        consoleSpy.mockRestore();
      }
    });
  });
});

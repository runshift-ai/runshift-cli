// ── Shared types mirroring the API contract ──

export interface RepoContext {
  packageJson: {
    name?: string;
    description?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
    workspaces?: string[] | { packages: string[] };
  };
  tsconfig: Record<string, unknown> | null;
  directoryTree: string[];
  envKeys: string[];
  configFiles: Record<string, string>;
  existingRules: Record<string, string>;
  migrationCount: number;
  migrationNames: string[];
  rootConfigs: string[];
  protectedPaths: string[];
  gitState: {
    branch: string;
    isDirty: boolean;
  } | null;
}

export interface GeneratedFile {
  path: string;
  content: string;
  action: "create" | "update";
}

export interface Findings {
  blastRadius: string[];
  securityGaps: string[];
  agentFailurePatterns: string[];
  parallelizationBoundaries: string[];
  deprecatedPatterns: string[];
}

export interface InitResponse {
  files: GeneratedFile[];
  findings: Findings;
  summary: string;
  previewId?: string;
}

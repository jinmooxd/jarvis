export type SessionStatus = "live" | "cold";

export type ContextInfo = {
  usedTokens: number;
  windowTokens: number;
  pct: number;
};

export type SessionSummary = {
  claudeSessionId: string;
  name: string;
  repoPath: string;
  gitBranch?: string;
  model: string;
  status: SessionStatus;
  context?: ContextInfo;
  lastModified: number;
  createdAt?: number;
};

export type ModelOption = {
  value: string;
  label: string;
  description?: string;
};

export type WorktreeInfo = {
  path: string;
  branch?: string;
  isMain: boolean;
};

export type WorktreeChoice =
  | { mode: "main" }
  | { mode: "existing"; path: string }
  | { mode: "new"; name: string };

export type SessionDetails = {
  claudeSessionId: string;
  name: string;
  status: SessionStatus;
  pid?: number;
  cwd?: string;
  host: string;
  model?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type RateLimitBucket = {
  status: "allowed" | "allowed_warning" | "rejected";
  utilization?: number;
  resetsAt?: number;
};

export type UsageState = Partial<Record<string, RateLimitBucket>>;

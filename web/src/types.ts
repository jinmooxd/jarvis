export type SessionStatus = "live" | "external" | "cold";

// Which jarvis instance a session lives on. Tagged client-side when the two
// lists are merged; the servers themselves don't know about origins.
export type SessionOrigin = "local" | "cloud";

export type CloudStatus = {
  configured: boolean;
  url?: string;
  connected: boolean;
  error?: string;
  checkedAt?: number;
};

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
  origin?: SessionOrigin;
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

import { EventEmitter } from "node:events";

export type RateLimitBucket = {
  status: "allowed" | "allowed_warning" | "rejected";
  utilization?: number;
  resetsAt?: number;
};

export type UsageState = Partial<Record<string, RateLimitBucket>>;

const state: UsageState = {};
const emitter = new EventEmitter();

export function recordRateLimitInfo(info: {
  rateLimitType?: string;
  status: "allowed" | "allowed_warning" | "rejected";
  utilization?: number;
  resetsAt?: number;
}) {
  if (!info.rateLimitType) return;
  state[info.rateLimitType] = {
    status: info.status,
    utilization: info.utilization,
    resetsAt: info.resetsAt,
  };
  emitter.emit("update", state);
}

export function getUsageState(): UsageState {
  return state;
}

export function onUsageUpdate(cb: (state: UsageState) => void): () => void {
  emitter.on("update", cb);
  return () => emitter.off("update", cb);
}

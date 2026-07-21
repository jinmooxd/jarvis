import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { SESSIONS_STORE_PATH } from "./config.js";

export type SessionRecord = {
  claudeSessionId: string;
  name: string;
  repoPath: string;
  worktreePath?: string;
  model: string;
  oneMillionContext?: boolean;
  createdAt: number;
};

type StoreShape = {
  records: Record<string, SessionRecord>;
  // sessions "closed" in the UI, keyed to the close time — activity in the
  // transcript after this timestamp automatically un-hides the session
  closed: Record<string, number>;
};

let store: StoreShape = { records: {}, closed: {} };
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  try {
    const text = await readFile(SESSIONS_STORE_PATH, "utf-8");
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && "records" in parsed) {
      store = { records: parsed.records ?? {}, closed: parsed.closed ?? {} };
    } else {
      // legacy shape: the whole file was the records map
      store = { records: parsed ?? {}, closed: {} };
    }
  } catch {
    store = { records: {}, closed: {} };
  }
  loaded = true;
}

async function persist() {
  await mkdir(dirname(SESSIONS_STORE_PATH), { recursive: true });
  await writeFile(SESSIONS_STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

export async function getAllRecords(): Promise<Record<string, SessionRecord>> {
  await ensureLoaded();
  return store.records;
}

export async function getRecord(claudeSessionId: string): Promise<SessionRecord | undefined> {
  await ensureLoaded();
  return store.records[claudeSessionId];
}

export async function putRecord(record: SessionRecord): Promise<void> {
  await ensureLoaded();
  store.records[record.claudeSessionId] = record;
  await persist();
}

export async function deleteRecord(claudeSessionId: string): Promise<void> {
  await ensureLoaded();
  delete store.records[claudeSessionId];
  await persist();
}

export async function getClosedMap(): Promise<Record<string, number>> {
  await ensureLoaded();
  return store.closed;
}

export async function markClosed(claudeSessionId: string): Promise<void> {
  await ensureLoaded();
  store.closed[claudeSessionId] = Date.now();
  await persist();
}

export async function unmarkClosed(claudeSessionId: string): Promise<void> {
  await ensureLoaded();
  if (claudeSessionId in store.closed) {
    delete store.closed[claudeSessionId];
    await persist();
  }
}

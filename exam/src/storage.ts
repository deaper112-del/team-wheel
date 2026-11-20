import type { AnswerKey, GradeReport, Paper, ResponseValue } from "./types";

const DB_NAME = "online-exam";
const STORE = "session";
const KEY = "current";

export interface SessionRecord {
  version: 1;
  phase: "ready" | "exam" | "result";
  paper: Paper;
  key: AnswerKey;
  name: string;
  responses: Record<string, ResponseValue>;
  startedAt: number | null;
  report: GradeReport | null;
  autoSubmitted: boolean;
  warning: string;
  questionLabel: string;
  answerLabel: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地数据库"));
  });
}

function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let settled = false;
        let value = undefined as T;
        const fail = (error: unknown) => {
          if (settled) return;
          settled = true;
          db.close();
          reject(error instanceof Error ? error : new Error("本地数据库读写失败"));
        };
        const tx = db.transaction(STORE, mode);
        const request = run(tx.objectStore(STORE));
        request.onsuccess = () => {
          value = request.result;
        };
        request.onerror = () => fail(request.error ?? new Error("本地数据库读写失败"));
        tx.oncomplete = () => {
          if (settled) return;
          settled = true;
          db.close();
          resolve(value);
        };
        tx.onerror = () => fail(tx.error ?? new Error("本地数据库读写失败"));
        tx.onabort = () => fail(tx.error ?? new Error("本地数据库读写失败"));
      }),
  );
}

export function loadSession(): Promise<SessionRecord | null> {
  return withStore<SessionRecord | undefined>("readonly", (store) => store.get(KEY)).then((value) => {
    if (!value || value.version !== 1 || !value.paper || !value.key) return null;
    return value;
  });
}

export function saveSession(record: SessionRecord): Promise<void> {
  const copy = structuredClone(record);
  return withStore("readwrite", (store) => store.put(copy, KEY)).then(() => undefined);
}

export function clearSession(): Promise<void> {
  return withStore("readwrite", (store) => store.delete(KEY)).then(() => undefined);
}

import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from "sql.js";
import { nanoid } from "nanoid";
import type { ArtifactKind, ArtifactRecord, Incident, RunBundle, RunRecord, RunStatus, RunStepRecord, StepName, StepStatus, Toolkit } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "runs.sqlite");

let ledgerPromise: Promise<RunLedger> | null = null;

export function getLedger(): Promise<RunLedger> {
  ledgerPromise ??= RunLedger.open();
  return ledgerPromise;
}

export class RunLedger {
  private constructor(
    private readonly SQL: SqlJsStatic,
    private readonly db: Database,
    private readonly persistToDisk: boolean
  ) {}

  static async open(options: { persistToDisk?: boolean } = {}): Promise<RunLedger> {
    const persistToDisk = options.persistToDisk ?? true;
    const SQL = await initSqlJs({
      locateFile: (file) => path.join(process.cwd(), "node_modules/sql.js/dist", file)
    });

    if (persistToDisk) fs.mkdirSync(DATA_DIR, { recursive: true });
    const db = persistToDisk && fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();
    const ledger = new RunLedger(SQL, db, persistToDisk);
    ledger.migrate();
    ledger.save();
    return ledger;
  }

  createOrGetRun(incident: Incident): { run: RunRecord; created: boolean } {
    const existing = this.getRunByFingerprint(incident.fingerprint);
    if (existing) return { run: existing, created: false };

    const id = `run_${nanoid(10)}`;
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO runs (id, incident_fingerprint, source, title, summary, status, current_step, error_message, incident_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        incident.fingerprint,
        incident.source,
        incident.title,
        incident.message,
        "queued",
        "received",
        null,
        JSON.stringify(incident),
        now,
        now
      ]
    );
    this.save();
    return { run: this.getRun(id), created: true };
  }

  listRuns(): RunRecord[] {
    return this.query(`SELECT * FROM runs ORDER BY created_at DESC LIMIT 50`).map(mapRun);
  }

  getRun(id: string): RunRecord {
    const row = this.queryOne(`SELECT * FROM runs WHERE id = ?`, [id]);
    if (!row) throw new Error(`Run not found: ${id}`);
    return mapRun(row);
  }

  getIncident(id: string): Incident {
    const row = this.queryOne(`SELECT incident_json FROM runs WHERE id = ?`, [id]);
    if (!row?.incident_json) throw new Error(`Incident not found for run: ${id}`);
    return JSON.parse(String(row.incident_json)) as Incident;
  }

  getBundle(id: string): RunBundle {
    return {
      run: this.getRun(id),
      steps: this.query(`SELECT * FROM run_steps WHERE run_id = ? ORDER BY started_at, rowid`, [id]).map(mapStep),
      artifacts: this.query(`SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at, rowid`, [id]).map(mapArtifact)
    };
  }

  setRunStatus(id: string, status: RunStatus, currentStep: StepName | null, errorMessage: string | null = null): void {
    this.db.run(`UPDATE runs SET status = ?, current_step = ?, error_message = ?, updated_at = ? WHERE id = ?`, [
      status,
      currentStep,
      errorMessage,
      new Date().toISOString(),
      id
    ]);
    this.save();
  }

  startStep(input: {
    runId: string;
    step: StepName;
    toolkit: Toolkit | "local";
    toolSlug: string;
    idempotencyKey: string;
  }): void {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT OR IGNORE INTO run_steps
       (id, run_id, step, status, idempotency_key, toolkit, tool_slug, attempts, started_at, data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`step_${nanoid(10)}`, input.runId, input.step, "pending", input.idempotencyKey, input.toolkit, input.toolSlug, 0, now, "{}"]
    );
    this.db.run(
      `UPDATE run_steps
       SET status = ?, attempts = attempts + 1, started_at = COALESCE(started_at, ?), message = NULL, error_code = NULL
       WHERE run_id = ? AND idempotency_key = ?`,
      ["running", now, input.runId, input.idempotencyKey]
    );
    this.setRunStatus(input.runId, "running", input.step);
  }

  finishStep(input: {
    runId: string;
    idempotencyKey: string;
    status: StepStatus;
    latencyMs?: number | null;
    composioLogId?: string | null;
    errorCode?: string | null;
    message?: string | null;
    data?: unknown;
  }): void {
    this.db.run(
      `UPDATE run_steps
       SET status = ?, latency_ms = ?, composio_log_id = COALESCE(?, composio_log_id), error_code = ?, message = ?, data_json = ?, finished_at = ?
       WHERE run_id = ? AND idempotency_key = ?`,
      [
        input.status,
        input.latencyMs ?? null,
        input.composioLogId ?? null,
        input.errorCode ?? null,
        input.message ?? null,
        JSON.stringify(input.data ?? {}),
        new Date().toISOString(),
        input.runId,
        input.idempotencyKey
      ]
    );
    this.save();
  }

  addArtifact(input: {
    runId: string;
    kind: ArtifactKind;
    label: string;
    externalId: string;
    externalUrl: string;
  }): ArtifactRecord {
    const existing = this.queryOne(`SELECT * FROM artifacts WHERE run_id = ? AND kind = ?`, [input.runId, input.kind]);
    if (existing) return mapArtifact(existing);

    const now = new Date().toISOString();
    const id = `artifact_${nanoid(10)}`;
    this.db.run(
      `INSERT INTO artifacts (id, run_id, kind, label, external_id, external_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.runId, input.kind, input.label, input.externalId, input.externalUrl, now]
    );
    this.save();
    return mapArtifact(this.queryOne(`SELECT * FROM artifacts WHERE id = ?`, [id])!);
  }

  private getRunByFingerprint(fingerprint: string): RunRecord | null {
    const row = this.queryOne(`SELECT * FROM runs WHERE incident_fingerprint = ?`, [fingerprint]);
    return row ? mapRun(row) : null;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        incident_fingerprint TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        current_step TEXT,
        error_message TEXT,
        incident_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS run_steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step TEXT NOT NULL,
        status TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        toolkit TEXT NOT NULL,
        tool_slug TEXT NOT NULL,
        composio_log_id TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER,
        error_code TEXT,
        message TEXT,
        started_at TEXT,
        finished_at TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY(run_id) REFERENCES runs(id)
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        external_id TEXT NOT NULL,
        external_url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(run_id, kind),
        FOREIGN KEY(run_id) REFERENCES runs(id)
      );
    `);
  }

  private query(sql: string, params: SqlValue[] = []): Array<Record<string, unknown>> {
    const stmt = this.db.prepare(sql, params);
    const rows: Array<Record<string, unknown>> = [];
    try {
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  private queryOne(sql: string, params: SqlValue[] = []): Record<string, unknown> | null {
    return this.query(sql, params)[0] ?? null;
  }

  private save(): void {
    if (!this.persistToDisk) return;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_PATH, Buffer.from(this.db.export()));
  }
}

function mapRun(row: Record<string, unknown>): RunRecord {
  return {
    id: String(row.id),
    incidentFingerprint: String(row.incident_fingerprint),
    source: row.source as RunRecord["source"],
    title: String(row.title),
    summary: String(row.summary),
    status: row.status as RunStatus,
    currentStep: row.current_step ? (String(row.current_step) as StepName) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapStep(row: Record<string, unknown>): RunStepRecord {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    step: row.step as StepName,
    status: row.status as StepStatus,
    idempotencyKey: String(row.idempotency_key),
    toolkit: row.toolkit as Toolkit | "local",
    toolSlug: String(row.tool_slug),
    composioLogId: row.composio_log_id ? String(row.composio_log_id) : null,
    attempts: Number(row.attempts),
    latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
    errorCode: row.error_code ? String(row.error_code) : null,
    message: row.message ? String(row.message) : null,
    startedAt: row.started_at ? String(row.started_at) : null,
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    data: row.data_json ? JSON.parse(String(row.data_json)) : {}
  };
}

function mapArtifact(row: Record<string, unknown>): ArtifactRecord {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    kind: row.kind as ArtifactKind,
    label: String(row.label),
    externalId: String(row.external_id),
    externalUrl: String(row.external_url),
    createdAt: String(row.created_at)
  };
}

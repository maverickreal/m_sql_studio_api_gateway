// packages/sat-hints/src/audit-logger.ts

import { promises as fs } from "node:fs";
import { dirname } from "node:path";

export interface AuditEvent {
  type: string;
  [key: string]: unknown;
}

export interface AuditLogger {
  emit(event: AuditEvent): void;
}

/**
 * File-backed audit logger.
 * Writes structured JSONL to local file — rotated daily.
 * Never transmits off-box per ADR.
 */
export class FileAuditLogger implements AuditLogger {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  emit(event: AuditEvent): void {
    const entry = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await fs.mkdir(dirname(this.filePath), { recursive: true });
        await fs.appendFile(
          this.filePath,
          JSON.stringify(entry) + "\n",
          "utf8",
        );
      } catch {
        // Best-effort: audit logging must not break hint flow
      }
    });
  }
}

/**
 * In-memory audit logger for testing — captures events in an array.
 */
export class InMemoryAuditLogger implements AuditLogger {
  private readonly events: AuditEvent[] = [];

  emit(event: AuditEvent): void {
    this.events.push(event);
  }

  getEvents(): AuditEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events.length = 0;
  }
}

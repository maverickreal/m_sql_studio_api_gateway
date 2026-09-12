import { promises as fs } from "node:fs";
import { dirname } from "node:path";

export interface ConsentStore {
  getSayConsent(): Promise<boolean>;
  setSayConsent(enabled: boolean): Promise<void>;
}

/**
 * File-backed consent store.
 * Writes JSON to a local file — no cloud sync per ADR.
 */
export class FileConsentStore implements ConsentStore {
  private readonly filePath: string;
  private cache: boolean | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async getSayConsent(): Promise<boolean> {
    if (this.cache !== null) {
      return this.cache;
    }

    try {
      const content = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content) as { say?: boolean };
      this.cache = parsed.say ?? false;
      return this.cache;
    } catch {
      // File not found or corrupt → default false (no consent)
      this.cache = false;
      return false;
    }
  }

  async setSayConsent(enabled: boolean): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify({ say: enabled }), "utf8");
    this.cache = enabled;
  }
}

/**
 * In-memory consent store for testing.
 */
export class InMemoryConsentStore implements ConsentStore {
  private value: boolean;

  constructor(initial = false) {
    this.value = initial;
  }

  async getSayConsent(): Promise<boolean> {
    return this.value;
  }

  async setSayConsent(enabled: boolean): Promise<void> {
    this.value = enabled;
  }
}

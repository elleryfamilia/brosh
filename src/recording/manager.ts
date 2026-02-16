import * as crypto from "crypto";
import { Recorder } from "./recorder.js";
import {
  RecordingMode,
  RecordingFormat,
  RecordingOptions,
  RecordingMetadata,
  StopReason,
} from "./types.js";
import { getDefaultRecordDir } from "../utils/platform.js";

/**
 * RecordingManager tracks and manages multiple recordings
 */
export class RecordingManager {
  private recordings: Map<string, Recorder> = new Map();
  private defaultOptions: RecordingOptions;

  constructor(options?: Partial<RecordingOptions>) {
    this.defaultOptions = {
      mode: options?.mode ?? 'off',
      format: options?.format ?? 'v2',
      outputDir: options?.outputDir ?? getDefaultRecordDir(),
      idleTimeLimit: options?.idleTimeLimit ?? 2,
      maxDuration: options?.maxDuration ?? 3600,        // 60 minutes default
      inactivityTimeout: options?.inactivityTimeout ?? 600,  // 10 minutes default
    };
  }

  /**
   * Create a new recording
   * Returns the recorder instance
   */
  createRecording(options?: Partial<RecordingOptions>): Recorder {
    const id = this.generateId();
    const mergedOptions: RecordingOptions = {
      ...this.defaultOptions,
      ...options,
    };

    const recorder = new Recorder(
      id,
      mergedOptions.mode,
      mergedOptions.outputDir,
      mergedOptions.format,
      mergedOptions.idleTimeLimit,
      mergedOptions.maxDuration,
      mergedOptions.inactivityTimeout
    );

    this.recordings.set(id, recorder);
    return recorder;
  }

  /**
   * Get a recording by ID
   */
  getRecording(id: string): Recorder | undefined {
    return this.recordings.get(id);
  }

  /**
   * Check if a recording exists
   */
  hasRecording(id: string): boolean {
    return this.recordings.has(id);
  }

  /**
   * Get all active recordings
   */
  getActiveRecordings(): Recorder[] {
    return Array.from(this.recordings.values()).filter(r => r.isActive());
  }

  /**
   * Get the count of active recordings
   */
  getActiveCount(): number {
    return this.getActiveRecordings().length;
  }

  /**
   * Record output to all active recordings
   */
  recordOutputToAll(data: string): void {
    for (const recorder of this.getActiveRecordings()) {
      recorder.recordOutput(data);
    }
  }

  /**
   * Record resize to all active recordings
   */
  recordResizeToAll(cols: number, rows: number): void {
    for (const recorder of this.getActiveRecordings()) {
      recorder.recordResize(cols, rows);
    }
  }

  /**
   * Finalize a specific recording
   */
  async finalizeRecording(id: string, exitCode: number | null, stopReason?: StopReason): Promise<RecordingMetadata | undefined> {
    const recorder = this.recordings.get(id);
    if (!recorder) {
      return undefined;
    }

    const metadata = await recorder.finalize(exitCode, stopReason);
    this.recordings.delete(id);
    return metadata;
  }

  /**
   * Finalize all active recordings
   * Returns array of metadata for all finalized recordings
   */
  async finalizeAll(exitCode: number | null, stopReason: StopReason = 'session_exit'): Promise<RecordingMetadata[]> {
    const results: RecordingMetadata[] = [];

    for (const [id, recorder] of this.recordings) {
      if (recorder.isActive()) {
        const metadata = await recorder.finalize(exitCode, stopReason);
        results.push(metadata);
      }
      this.recordings.delete(id);
    }

    return results;
  }

  /**
   * Get default recording mode
   */
  getDefaultMode(): RecordingMode {
    return this.defaultOptions.mode;
  }

  /**
   * Get default output directory
   */
  getDefaultOutputDir(): string {
    return this.defaultOptions.outputDir;
  }

  /**
   * Check if auto-recording is enabled (mode !== 'off')
   */
  isAutoRecordingEnabled(): boolean {
    return this.defaultOptions.mode !== 'off';
  }

  private generateId(): string {
    return crypto.randomBytes(8).toString('hex');
  }
}

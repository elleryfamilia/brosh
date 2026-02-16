/**
 * ML-Based Text Classifier using brosh-ky
 *
 * Uses a fine-tuned MiniLM-L6-v2 model for distinguishing
 * shell commands from natural language queries.
 *
 * Features:
 * - Lazy loading: Model only loaded on first classification
 * - Local model: Bundled with app, no network needed
 * - Fast inference: ~10-15ms per classification
 * - High accuracy: 99%+ on test cases
 */

import { app } from "electron";
import path from "path";
import { fileURLToPath } from "url";

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamic import to handle ESM/CommonJS issues in Electron
let pipeline: typeof import("@huggingface/transformers").pipeline | null = null;
let env: typeof import("@huggingface/transformers").env | null = null;
let classifier: Awaited<
  ReturnType<typeof import("@huggingface/transformers").pipeline>
> | null = null;

// Model configuration
const MODEL_NAME = "brosh-ky";

// Loading state
let isLoading = false;
let loadError: Error | null = null;

// Debug logging
const debug = (msg: string, ...args: unknown[]) => {
  if (process.env.DEBUG_AI_DETECTION || process.env.DEBUG_ML_CLASSIFIER) {
    console.log(`[ml-classifier] ${msg}`, ...args);
  }
};

/**
 * Get the path to the bundled models directory
 */
function getModelsPath(): string {
  // In production, models are in the app resources
  // In development, they're in the source directory
  const isDev = !app.isPackaged;

  if (isDev) {
    return path.join(__dirname, "..", "..", "models");
  } else {
    // In packaged app, models are in resources/models
    return path.join(process.resourcesPath, "models");
  }
}

/**
 * Model loading status
 */
export interface ModelStatus {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  modelName: string;
}

/**
 * Get current model status
 */
export function getModelStatus(): ModelStatus {
  return {
    loaded: classifier !== null,
    loading: isLoading,
    error: loadError?.message || null,
    modelName: MODEL_NAME,
  };
}

/**
 * Load the classifier model
 * Uses the bundled brosh-ky model (fine-tuned MiniLM-L6-v2)
 */
async function loadClassifier(): Promise<boolean> {
  if (classifier) return true;
  if (isLoading) {
    // Wait for existing load to complete
    while (isLoading) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return classifier !== null;
  }

  isLoading = true;
  loadError = null;

  try {
    debug("Loading transformers.js...");
    const startTime = performance.now();

    // Dynamic import of transformers.js
    const transformers = await import("@huggingface/transformers");
    pipeline = transformers.pipeline;
    env = transformers.env;

    // Configure for local model loading
    const modelsPath = getModelsPath();
    debug(`Models path: ${modelsPath}`);

    env.localModelPath = modelsPath;
    env.allowLocalModels = true;
    env.allowRemoteModels = false; // Don't download from HF

    debug(`Loading ${MODEL_NAME} model...`);
    classifier = await pipeline("text-classification", MODEL_NAME, {
      local_files_only: true,
    });

    const loadTime = performance.now() - startTime;
    debug(`Model loaded in ${loadTime.toFixed(0)}ms`);

    // Warm up with a simple classification
    debug("Warming up model...");
    const warmupStart = performance.now();
    await classifier("ls -la");
    const warmupTime = performance.now() - warmupStart;
    debug(`Warmup complete in ${warmupTime.toFixed(0)}ms`);

    return true;
  } catch (error) {
    loadError = error instanceof Error ? error : new Error(String(error));
    console.error("[ml-classifier] Failed to load model:", loadError);
    return false;
  } finally {
    isLoading = false;
  }
}

/**
 * Classification result from ML model
 */
export interface MLClassificationResult {
  classification: "COMMAND" | "NATURAL_LANGUAGE" | "AMBIGUOUS";
  confidence: number;
  scores: {
    command: number;
    naturalLanguage: number;
  };
  inferenceTimeMs: number;
}

/**
 * Text classification result type
 */
interface TextClassificationResult {
  label: string;
  score: number;
}

/**
 * Classify input using the brosh-ky model
 *
 * @param input - The text to classify
 * @returns Classification result with confidence scores
 */
export async function classifyWithML(
  input: string
): Promise<MLClassificationResult | null> {
  // Ensure model is loaded
  const loaded = await loadClassifier();
  if (!loaded || !classifier) {
    debug("Model not available, skipping ML classification");
    return null;
  }

  try {
    const startTime = performance.now();

    // Run text classification
    // Cast to any to work around strict typing issues with transformers.js
    const rawResult = await (classifier as Function)(input, { top_k: 2 });

    const inferenceTime = performance.now() - startTime;
    debug(
      `Classified "${input.slice(0, 50)}${input.length > 50 ? "..." : ""}" in ${inferenceTime.toFixed(1)}ms`
    );

    // Parse results - text-classification returns array of {label, score}
    const results = rawResult as TextClassificationResult[];

    // Find scores for each category
    let commandScore = 0;
    let nlScore = 0;

    for (const result of results) {
      if (result.label === "command") {
        commandScore = result.score;
      } else if (result.label === "natural_language") {
        nlScore = result.score;
      }
    }

    debug(
      `Scores - Command: ${commandScore.toFixed(3)}, NL: ${nlScore.toFixed(3)}`
    );

    // Determine classification based on scores
    let classification: "COMMAND" | "NATURAL_LANGUAGE" | "AMBIGUOUS";
    let confidence: number;

    const scoreDiff = Math.abs(commandScore - nlScore);

    if (scoreDiff < 0.1) {
      // Scores too close - ambiguous
      classification = "AMBIGUOUS";
      confidence = Math.max(commandScore, nlScore);
    } else if (commandScore > nlScore) {
      classification = "COMMAND";
      confidence = commandScore;
    } else {
      classification = "NATURAL_LANGUAGE";
      confidence = nlScore;
    }

    return {
      classification,
      confidence,
      scores: {
        command: commandScore,
        naturalLanguage: nlScore,
      },
      inferenceTimeMs: inferenceTime,
    };
  } catch (error) {
    console.error("[ml-classifier] Classification failed:", error);
    return null;
  }
}

/**
 * Preload the model (call during app startup for faster first classification)
 */
export async function preloadModel(): Promise<boolean> {
  debug("Preloading model...");
  return loadClassifier();
}

/**
 * Check if the model is ready for classification
 */
export function isModelReady(): boolean {
  return classifier !== null && !isLoading;
}

/**
 * Unload the model to free memory
 */
export async function unloadModel(): Promise<void> {
  if (classifier) {
    // Transformers.js doesn't have an explicit unload, but we can clear the reference
    classifier = null;
    debug("Model unloaded");
  }
}

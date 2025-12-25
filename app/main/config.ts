/**
 * Application Configuration
 * Centralized configuration values for the application
 */

export interface AppConfig {
  embedding: {
    batchSize: number;
    timeout: number;
  };
}

/**
 * Default application configuration
 */
export const defaultConfig: AppConfig = {
  embedding: {
    batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE || '4', 10),
    timeout: parseInt(process.env.EMBEDDING_TIMEOUT || '30000', 10),
  },
};

/**
 * Get application configuration
 * Can be extended to load from file or environment variables
 */
export function getConfig(): AppConfig {
  return defaultConfig;
}

/**
 * Get embedding batch size from config
 */
export function getEmbeddingBatchSize(): number {
  return getConfig().embedding.batchSize;
}


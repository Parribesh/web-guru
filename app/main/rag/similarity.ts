import { ContentChunk, SearchResult } from '../../shared/types';

export function cosineSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length) {
    throw new Error(`Vectors must have the same length: ${vec1.length} vs ${vec2.length}`);
  }

  if (vec1.length === 0) {
    throw new Error('Vectors cannot be empty');
  }

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    const v1 = vec1[i];
    const v2 = vec2[i];
    
    // Check for invalid values
    if (isNaN(v1) || isNaN(v2) || !isFinite(v1) || !isFinite(v2)) {
      throw new Error(`Invalid vector values at index ${i}: v1=${v1}, v2=${v2}`);
    }
    
    dotProduct += v1 * v2;
    norm1 += v1 * v1;
    norm2 += v2 * v2;
  }

  const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
  if (denominator === 0) {
    // Both vectors are zero vectors
    return 0;
  }

  const similarity = dotProduct / denominator;
  
  // Validate result
  if (isNaN(similarity) || !isFinite(similarity)) {
    throw new Error(`Invalid similarity result: ${similarity} (dotProduct=${dotProduct}, norm1=${norm1}, norm2=${norm2})`);
  }
  
  // Clamp to [-1, 1] range (should already be there for normalized vectors, but just in case)
  return Math.max(-1, Math.min(1, similarity));
}

export function searchSimilarChunks(
  questionEmbedding: number[],
  chunks: ContentChunk[],
  chunkEmbeddings: Map<string, number[]>,
  topK: number = 3,
  onProgress?: (current: number, total: number, similarity?: number) => void
): SearchResult[] {
  const results: SearchResult[] = [];
  let processed = 0;

  for (const chunk of chunks) {
    const chunkEmbedding = chunkEmbeddings.get(chunk.id);
    if (!chunkEmbedding) {
      continue;
    }

    const similarity = cosineSimilarity(questionEmbedding, chunkEmbedding);
    results.push({
      chunk,
      similarity,
      rank: 0, // Will be set after sorting
    });
    
    processed++;
    if (onProgress) {
      onProgress(processed, chunks.length, similarity);
    }
  }

  // Sort by similarity (descending)
  results.sort((a, b) => b.similarity - a.similarity);

  // Set ranks
  results.forEach((result, index) => {
    result.rank = index + 1;
  });

  // Return top K
  return results.slice(0, topK);
}



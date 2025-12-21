// Component Type Filter - Filters chunks by component type based on query intent

import { ContentChunk, ComponentType } from '../../../shared/types';
import { eventLogger } from '../../logging/event-logger';
import { generateEmbedding } from './embeddings';
import { cosineSimilarity } from './similarity';

// Semantic descriptions for each component type - these help understand query intent
const COMPONENT_TYPE_DESCRIPTIONS: Record<ComponentType, string> = {
  'form': 'HTML form element with input fields for user data entry, form submission, filling out information, entering data, submitting forms',
  'input-group': 'Input field, text field, form field, data entry field, user input, text input, email input, password input, checkbox, radio button, dropdown, select',
  'button': 'Button element, clickable button, submit button, action button, press button, trigger action, activate button, interactive button',
  'table': 'Data table, structured data, rows and columns, tabular data, data grid, information table, data list, chart data',
  'list': 'List of items, unordered list, ordered list, item list, collection of items',
  'text': 'Text content, paragraph, article text, written content, textual information',
  'section': 'Content section, page section, part of page, content area, section of content',
  'heading': 'Heading, title, header, section title, page heading, content heading',
};

// Cache for component type embeddings (computed once)
let componentTypeEmbeddings: Map<ComponentType, number[]> | null = null;

/**
 * Initialize component type embeddings (called once)
 */
async function initializeComponentTypeEmbeddings(): Promise<Map<ComponentType, number[]>> {
  if (componentTypeEmbeddings) {
    return componentTypeEmbeddings;
  }

  eventLogger.info('Component Filter', 'Initializing component type embeddings for semantic detection...');
  componentTypeEmbeddings = new Map<ComponentType, number[]>();

  for (const [type, description] of Object.entries(COMPONENT_TYPE_DESCRIPTIONS)) {
    try {
      const embedding = await generateEmbedding(description);
      componentTypeEmbeddings.set(type as ComponentType, embedding);
      eventLogger.debug('Component Filter', `Generated embedding for component type: ${type}`);
    } catch (error) {
      eventLogger.error('Component Filter', `Failed to generate embedding for ${type}`, error instanceof Error ? error.message : String(error));
    }
  }

  eventLogger.success('Component Filter', `Initialized ${componentTypeEmbeddings.size} component type embeddings`);
  return componentTypeEmbeddings;
}

/**
 * Detects which component types are relevant based on the query using semantic similarity
 */
export async function detectRelevantComponentTypes(question: string): Promise<ComponentType[]> {
  eventLogger.info('Component Filter', `Detecting component types for query: "${question.substring(0, 50)}..."`);
  
  // Initialize embeddings if needed
  const typeEmbeddings = await initializeComponentTypeEmbeddings();
  
  // Generate embedding for the question
  let questionEmbedding: number[];
  try {
    questionEmbedding = await generateEmbedding(question);
  } catch (error) {
    eventLogger.error('Component Filter', 'Failed to generate question embedding, falling back to all chunks', error instanceof Error ? error.message : String(error));
    return []; // Return empty to search all chunks
  }

  // Calculate similarity between question and each component type
  const similarities: Array<{ type: ComponentType; similarity: number }> = [];
  
  for (const [type, typeEmbedding] of typeEmbeddings.entries()) {
    try {
      const similarity = cosineSimilarity(questionEmbedding, typeEmbedding);
      similarities.push({ type, similarity });
      eventLogger.debug('Component Filter', `Similarity for ${type}: ${similarity.toFixed(3)}`);
    } catch (error) {
      eventLogger.warning('Component Filter', `Failed to calculate similarity for ${type}`, error instanceof Error ? error.message : String(error));
    }
  }

  // Sort by similarity (descending)
  similarities.sort((a, b) => b.similarity - a.similarity);

  // Use a threshold to determine relevant types
  // We'll use a dynamic threshold: top 2 types OR any type above 0.3 similarity
  const SIMILARITY_THRESHOLD = 0.3;
  const TOP_N_TYPES = 2;
  
  const relevantTypes: ComponentType[] = [];
  
  // Always include top N types
  for (let i = 0; i < Math.min(TOP_N_TYPES, similarities.length); i++) {
    if (similarities[i].similarity > 0.2) { // Minimum threshold even for top types
      relevantTypes.push(similarities[i].type);
      eventLogger.debug('Component Filter', `Top ${i + 1} type: ${similarities[i].type} (similarity: ${similarities[i].similarity.toFixed(3)})`);
    }
  }
  
  // Also include any types above the threshold
  for (const { type, similarity } of similarities) {
    if (similarity >= SIMILARITY_THRESHOLD && !relevantTypes.includes(type)) {
      relevantTypes.push(type);
      eventLogger.debug('Component Filter', `Above-threshold type: ${type} (similarity: ${similarity.toFixed(3)})`);
    }
  }

  // Remove text, section, heading from results if we have more specific types
  // (these are too generic and will match almost everything)
  if (relevantTypes.length > 1) {
    const genericTypes: ComponentType[] = ['text', 'section', 'heading'];
    const hasSpecificTypes = relevantTypes.some(t => !genericTypes.includes(t));
    if (hasSpecificTypes) {
      const filtered = relevantTypes.filter(t => !genericTypes.includes(t));
      if (filtered.length > 0) {
        relevantTypes.length = 0;
        relevantTypes.push(...filtered);
      }
    }
  }

  if (relevantTypes.length === 0) {
    eventLogger.info('Component Filter', 'No specific component types detected with sufficient similarity - will search all chunks');
  } else {
    eventLogger.info('Component Filter', `Detected relevant component types (semantic): ${relevantTypes.join(', ')}`);
    // Log similarities for debugging
    relevantTypes.forEach(type => {
      const sim = similarities.find(s => s.type === type);
      if (sim) {
        eventLogger.debug('Component Filter', `  - ${type}: ${sim.similarity.toFixed(3)} similarity`);
      }
    });
  }

  return relevantTypes;
}

/**
 * Filters chunks by component type
 */
export function filterChunksByComponentType(
  chunks: ContentChunk[],
  componentTypes: ComponentType[]
): ContentChunk[] {
  if (componentTypes.length === 0) {
    // No filter - return all chunks
    return chunks;
  }

  const filtered = chunks.filter(chunk => {
    // Include chunks that match any of the specified component types
    if (chunk.componentType && componentTypes.includes(chunk.componentType)) {
      return true;
    }
    
    // Also include text chunks if we're looking for forms/inputs (they might contain form descriptions)
    if (componentTypes.includes('form') || componentTypes.includes('input-group')) {
      if (chunk.componentType === 'text' || !chunk.componentType) {
        // Check if text content mentions forms/inputs
        const content = chunk.content.toLowerCase();
        if (/\b(form|input|field|submit|button)\b/i.test(content)) {
          return true;
        }
      }
    }
    
    return false;
  });

  eventLogger.info('Component Filter', `Filtered ${chunks.length} chunks to ${filtered.length} chunks (types: ${componentTypes.join(', ')})`);
  
  return filtered;
}

/**
 * Gets all component chunks of a specific type
 */
export function getComponentChunksByType(
  chunks: ContentChunk[],
  componentType: ComponentType
): ContentChunk[] {
  return chunks.filter(chunk => chunk.componentType === componentType);
}

/**
 * Gets all interactive component chunks (forms, buttons, inputs)
 */
export function getInteractiveComponentChunks(chunks: ContentChunk[]): ContentChunk[] {
  return chunks.filter(chunk => {
    if (!chunk.componentType || chunk.componentType === 'text' || chunk.componentType === 'section' || chunk.componentType === 'heading') {
      return false;
    }
    return chunk.componentData?.metadata.isInteractive === true;
  });
}

/**
 * Groups chunks by component type for analysis
 */
export function groupChunksByComponentType(chunks: ContentChunk[]): Map<ComponentType, ContentChunk[]> {
  const grouped = new Map<ComponentType, ContentChunk[]>();
  
  chunks.forEach(chunk => {
    const type = chunk.componentType || 'text';
    if (!grouped.has(type)) {
      grouped.set(type, []);
    }
    grouped.get(type)!.push(chunk);
  });
  
  return grouped;
}


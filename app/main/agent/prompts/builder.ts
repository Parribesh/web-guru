// Prompt Builder - Builds formatted prompts from context

import { RetrievedContext } from '../../../shared/types';
import { eventLogger } from '../../logging/event-logger';

// Limit chunk content to prevent prompt from being too long
const MAX_PROMPT_TOKENS = 1200;
// Note: Component chunks may exceed 800 chars as they contain complete elements (forms, tables, etc.)
// This is expected and intentional - we preserve complete semantic units
const MAX_CHARS_PER_CHUNK = 800; // Reference size for text chunks only

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}

export function buildPrompt(
  question: string,
  context: RetrievedContext,
  metadata: { url: string; title: string }
): string {
  // More concise prompt for faster processing
  const questionAndInstructions = `Answer this question using ONLY the content below. Be concise and accurate.

Question: ${question}
Page: ${metadata.title}

Content:
`;

  // Reduced available chars for faster processing
  const availableChars = (MAX_PROMPT_TOKENS * 3) - questionAndInstructions.length - 300;
  
  let totalChars = 0;
  const limitedChunks: string[] = [];
  
  for (let i = 0; i < context.primaryChunks.length; i++) {
    const chunk = context.primaryChunks[i];
    const chunkContent = chunk.content || '';
    
    // Component chunks (forms, buttons, tables) may exceed 800 chars as they contain complete elements
    // This is expected and intentional - we preserve complete semantic units
    if (chunk.componentType && chunk.componentType !== 'text' && chunkContent.length > MAX_CHARS_PER_CHUNK) {
      eventLogger.debug('Prompt Builder', `Component chunk ${i + 1} (${chunk.componentType}) is ${chunkContent.length} chars - complete element preserved`);
    } else if (!chunk.componentType || chunk.componentType === 'text') {
      // Only warn for text chunks that exceed size limit
      if (chunkContent.length > MAX_CHARS_PER_CHUNK * 1.5) {
        eventLogger.warning('Prompt Builder', `Text chunk ${i + 1} is ${chunkContent.length} chars (expected max ${MAX_CHARS_PER_CHUNK}). This should have been split during chunking.`);
      }
    }
    
    const heading = chunk.metadata.heading ? `\n### ${chunk.metadata.heading}\n` : '';
    
    // Include component information if available
    let componentInfo = '';
    if (chunk.componentType && chunk.componentType !== 'text' && chunk.componentData) {
      const comp = chunk.componentData;
      componentInfo = `\n[Component: ${chunk.componentType}]\n`;
      componentInfo += `Selector: ${comp.selector}\n`;
      if (comp.metadata.isInteractive) {
        componentInfo += `Interactive: Yes\n`;
      }
      if (comp.metadata.formId) {
        componentInfo += `Form ID: ${comp.metadata.formId}\n`;
      }
      if (comp.metadata.inputType) {
        componentInfo += `Input Type: ${comp.metadata.inputType}\n`;
      }
      if (comp.metadata.label) {
        componentInfo += `Label: ${comp.metadata.label}\n`;
      }
      if (comp.metadata.required) {
        componentInfo += `Required: Yes\n`;
      }
      
      // Include nested chunks information (e.g., form's inputs and buttons)
      if (chunk.nestedChunks && chunk.nestedChunks.length > 0) {
        componentInfo += `\nNested Components (${chunk.nestedChunks.length}):\n`;
        chunk.nestedChunks.forEach((nested, idx) => {
          componentInfo += `  ${idx + 1}. ${nested.componentType}: ${nested.componentData?.selector || 'N/A'}`;
          if (nested.componentData?.metadata.label) {
            componentInfo += ` (${nested.componentData.metadata.label})`;
          }
          componentInfo += '\n';
        });
      }
      componentInfo += '\n';
    }
    
    const chunkText = `${heading}[Relevant Content ${i + 1}${chunk.componentType && chunk.componentType !== 'text' ? ` - ${chunk.componentType}` : ''}]\n${componentInfo}${chunkContent}\n`;
    
    // Check if adding this chunk would exceed our limit
    if (totalChars + chunkText.length > availableChars) {
      eventLogger.warning('Prompt Builder', `Stopping at chunk ${i + 1}/${context.primaryChunks.length} to stay within token limit`);
      break;
    }
    
    limitedChunks.push(chunkText);
    totalChars += chunkText.length;
  }

  const chunksText = limitedChunks.join('\n---\n\n');
  const finalPrompt = questionAndInstructions + chunksText + '\n\nAnswer:';
  
  const estimatedTokens = estimateTokens(finalPrompt);
  eventLogger.info('Prompt Builder', `Prompt size: ~${estimatedTokens} tokens (${finalPrompt.length} chars), using ${limitedChunks.length}/${context.primaryChunks.length} chunks`);
  
  if (estimatedTokens > MAX_PROMPT_TOKENS) {
    eventLogger.warning('Prompt Builder', `Prompt may exceed token limit (${estimatedTokens} > ${MAX_PROMPT_TOKENS})`);
  }
  
  return finalPrompt;
}


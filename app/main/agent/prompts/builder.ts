// Prompt Builder - Builds formatted prompts from context

import { RetrievedContext } from '../../../shared/types';
import { eventLogger } from '../../logging/event-logger';

// Limit chunk content to prevent prompt from being too long
const MAX_PROMPT_TOKENS = 1200;
const MAX_CHARS_PER_CHUNK = 800;

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
    
    // Chunks should already be split to 800 chars max during chunking
    if (chunkContent.length > MAX_CHARS_PER_CHUNK * 1.5) {
      eventLogger.warning('Prompt Builder', `Chunk ${i + 1} is ${chunkContent.length} chars (expected max ${MAX_CHARS_PER_CHUNK}). This should have been split during chunking.`);
    }
    
    const heading = chunk.metadata.heading ? `\n### ${chunk.metadata.heading}\n` : '';
    const chunkText = `${heading}[Relevant Content ${i + 1}]\n${chunkContent}\n`;
    
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


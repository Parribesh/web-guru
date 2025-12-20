// QA Service - Orchestrates RAG → Prompt → LLM → Response

import { QARequest, QAResponse, SearchResult } from '../../../shared/types';
import { getContextForQuestion } from '../rag/context';
import { buildPrompt } from '../prompts/builder';
import { generateAnswer } from '../llm/service';
import { eventLogger } from '../../logging/event-logger';

export async function answerQuestion(request: QARequest): Promise<QAResponse> {
  const startTime = Date.now();
  eventLogger.info('QA Service', `💭 Processing your question...`);
  eventLogger.debug('QA Service', `Question: "${request.question.substring(0, 50)}..."`);
  eventLogger.debug('QA Service', `Tab ID: ${request.tabId}`);

  try {
    // Step 1: Get context from RAG system
    const contextResult = await getContextForQuestion(request.question, request.tabId);
    
    if (!contextResult) {
      eventLogger.warning('QA Service', 'No context found for question');
      return {
        success: false,
        answer: '',
        explanation: '',
        relevantChunks: [],
        confidence: 0,
        sourceLocation: {
          approximatePosition: 'unknown',
        },
        error: 'Page content not cached. Please wait for page to load completely.',
      };
    }

    const { context, searchResults, cache } = contextResult;

    if (!cache) {
      eventLogger.warning('QA Service', 'No cache found in context result');
      return {
        success: false,
        answer: '',
        explanation: '',
        relevantChunks: [],
        confidence: 0,
        sourceLocation: {
          approximatePosition: 'unknown',
        },
        error: 'Page content not cached. Please wait for page to load completely.',
      };
    }

    // Step 2: Build prompt
    eventLogger.info('QA Service', `🤖 Building prompt...`);
    const prompt = buildPrompt(
      request.question,
      context,
      {
        url: cache.pageContent.url,
        title: cache.pageContent.title,
      }
    );

    // Step 3: Generate answer using LLM
    eventLogger.info('QA Service', `🤖 Generating answer...`);
    let answer: string;
    let finalPrompt: string;
    
    try {
      const result = await generateAnswer(prompt);
      answer = result.answer;
      finalPrompt = result.prompt;
      eventLogger.info('QA Service', '✅ Answer generated');
    } catch (error: any) {
      eventLogger.error('QA Service', 'Answer generation failed', {
        message: error.message,
        code: error.code,
      });
      
      // If Ollama is not available, provide a fallback response
      if (error.message?.includes('Ollama is not running') || 
          error.message?.includes('connection check failed') ||
          error.code === 'ECONNREFUSED') {
        eventLogger.warning('QA Service', 'Ollama not available, providing fallback response');
        answer = `I found relevant information, but I cannot generate a full answer because Ollama is not running.\n\n` +
          `Please start Ollama with: ollama serve\n\n` +
          `Relevant content from the page:\n${context.primaryChunks.map((c, i) => `\n[${i + 1}] ${c.content.substring(0, 200)}...`).join('\n')}`;
        finalPrompt = prompt;
      } else {
        eventLogger.error('QA Service', 'Failed to generate answer', error.message || error);
        throw error;
      }
    }

    // Step 4: Format response
    const avgSimilarity = searchResults.reduce((sum: number, r: SearchResult) => sum + r.similarity, 0) / searchResults.length;
    const confidence = Math.min(avgSimilarity * 1.2, 1.0);

    const relevantChunks = searchResults.map((result, index) => {
      const chunkContent = result.chunk.content || '';
      const excerpt = chunkContent.length > 300 
        ? chunkContent.substring(0, 300) + '...' 
        : chunkContent;
      
      return {
        chunkId: result.chunk.id,
        excerpt: excerpt || 'No content available',
        relevance: `Similarity: ${(result.similarity * 100).toFixed(1)}%`,
      };
    });

    const processingTime = Date.now() - startTime;
    eventLogger.success('QA Service', `Question answered in ${processingTime}ms`);

    return {
      success: true,
      answer,
      explanation: `Based on ${searchResults.length} relevant section(s) from the page.`,
      relevantChunks,
      confidence,
      prompt: finalPrompt,
      sourceLocation: {
        section: context.sectionContext.heading,
        approximatePosition: `Section ${searchResults[0].rank} of ${cache.chunks.length}`,
      },
      metadata: {
        processingTime,
        chunksSearched: cache.chunks.length,
        model: 'llama3.2:latest',
      },
    };
  } catch (error) {
    eventLogger.error('QA Service', 'QA service error', error instanceof Error ? error.message : 'Unknown error');
    return {
      success: false,
      answer: '',
      explanation: '',
      relevantChunks: [],
      confidence: 0,
      sourceLocation: {
        approximatePosition: 'unknown',
      },
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      metadata: {
        processingTime: Date.now() - startTime,
      },
    };
  }
}


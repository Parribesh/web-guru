import { ContentChunk, PageContent, Section, Heading, ComponentType, DOMComponent } from '../../../shared/types';
import { v4 as uuidv4 } from 'uuid';
import { eventLogger } from '../../logging/event-logger';
import { extractComponents } from './components';

const MIN_CHUNK_SIZE = 100; // Minimum words per chunk (for text chunks only)
const MAX_CHUNK_SIZE = 200; // Maximum words per chunk (~800 chars) (for text chunks only)
const MAX_CHUNK_CHARS = 800; // Preferred max chars per chunk (for combining multiple paragraphs)
const MAX_PARAGRAPH_CHARS = 3000; // Maximum chars for a single paragraph before splitting
// Note: Component chunks (forms, buttons, tables) are NOT limited by size - they contain complete elements
// Note: Individual paragraphs are preserved as complete units unless they exceed MAX_PARAGRAPH_CHARS
const OVERLAP_WORDS = 50; // Words to overlap between chunks
const SENTENCE_OVERLAP = 2; // Number of sentences to overlap when splitting large paragraphs

export function chunkContent(pageContent: PageContent, components: DOMComponent[] = []): ContentChunk[] {
  eventLogger.info('Chunking', `Starting content chunking for page: ${pageContent.title}`);
  const chunks: ContentChunk[] = [];
  const { extractedText, structure } = pageContent;

  // Log section info for debugging
  if (structure.sections.length > 0) {
    eventLogger.info('Chunking', `Found ${structure.sections.length} sections`);
    structure.sections.forEach((section, idx) => {
      const contentLength = section.content ? section.content.length : 0;
      const wordCount = section.content ? section.content.split(/\s+/).length : 0;
      eventLogger.debug('Chunking', `Section ${idx + 1}: "${section.heading || 'No heading'}" - ${contentLength} chars, ${wordCount} words`);
    });
  }

  // Strategy 1: Component-based chunking (preferred for interactive elements)
  if (components.length > 0) {
    eventLogger.info('Chunking', `Found ${components.length} components, creating component-aware chunks`);
    chunks.push(...chunkByComponents(extractedText, structure.sections, components));
  }

  // Strategy 2: Section-based chunking (for text content)
  if (structure.sections.length > 0) {
    const sectionChunks = chunkBySections(extractedText, structure.sections);
    // Only add section chunks that don't overlap with component chunks
    const componentSelectors = new Set(components.map(c => c.selector));
    sectionChunks.forEach(sectionChunk => {
      // Check if this section chunk overlaps with a component
      const hasOverlap = components.some(comp => 
        sectionChunk.content.includes(comp.textContent) || 
        (sectionChunk.metadata.domPath && componentSelectors.has(sectionChunk.metadata.domPath))
      );
      if (!hasOverlap) {
        chunks.push(sectionChunk);
      }
    });
  } else {
    // Strategy 3: Paragraph-based with overlap (fallback)
    chunks.push(...chunkByParagraphs(extractedText));
  }
  
  // Log chunk info for debugging
  chunks.forEach((chunk, idx) => {
    const contentLength = chunk.content ? chunk.content.length : 0;
    const wordCount = chunk.content ? chunk.content.split(/\s+/).length : 0;
    if (contentLength === 0) {
      eventLogger.warning('Chunking', `Chunk ${idx + 1} has no content! Heading: "${chunk.metadata.heading || 'No heading'}"`);
    } else if (chunk.componentType && chunk.componentType !== 'text') {
      // Component chunks (forms, buttons, tables) are intentionally complete and may exceed size limits
      eventLogger.debug('Chunking', `Component chunk ${idx + 1} (${chunk.componentType}): ${contentLength} chars - complete element preserved`);
    } else if (contentLength > MAX_PARAGRAPH_CHARS) {
      // Warn if a single paragraph exceeds MAX_PARAGRAPH_CHARS (should have been split)
      eventLogger.warning('Chunking', `Text chunk ${idx + 1} is very large: ${contentLength} chars (max ${MAX_PARAGRAPH_CHARS} for single paragraph). Heading: "${chunk.metadata.heading || 'No heading'}"`);
    } else if (contentLength > MAX_CHUNK_CHARS) {
      // Info log for paragraphs between MAX_CHUNK_CHARS and MAX_PARAGRAPH_CHARS (expected and preserved)
      eventLogger.debug('Chunking', `Text chunk ${idx + 1}: ${contentLength} chars - complete paragraph preserved (exceeds preferred ${MAX_CHUNK_CHARS} but within ${MAX_PARAGRAPH_CHARS} limit)`);
    }
  });

  // Add metadata to chunks and ensure componentType is set
  const finalChunks = chunks.map((chunk, index) => ({
    ...chunk,
    componentType: chunk.componentType || 'text', // Default to 'text' if not set
    metadata: {
      ...chunk.metadata,
      surroundingContext: {
        previousChunk: index > 0 ? chunks[index - 1].content.substring(0, 100) : undefined,
        nextChunk: index < chunks.length - 1 ? chunks[index + 1].content.substring(0, 100) : undefined,
      },
    },
  }));

  eventLogger.success('Chunking', `Created ${finalChunks.length} chunks from page content`);
  return finalChunks;
}

function chunkBySections(text: string, sections: Section[]): ContentChunk[] {
  const chunks: ContentChunk[] = [];

  for (const section of sections) {
    const sectionText = (section.content || '').trim();
    const wordCount = sectionText.split(/\s+/).filter(w => w.length > 0).length;
    
    // Skip sections with no content
    if (wordCount === 0) {
      eventLogger.warning('Chunking', `Skipping section "${section.heading || 'No heading'}" - no content`);
      continue;
    }

    // Check both word count and character count
    const charCount = sectionText.length;
    const fitsInOneChunk = wordCount <= MAX_CHUNK_SIZE && charCount <= MAX_CHUNK_CHARS;
    
    if (fitsInOneChunk) {
      // Section fits in one chunk
      chunks.push({
        id: uuidv4(),
        content: sectionText,
        componentType: 'section',
        metadata: {
          sectionId: section.id,
          heading: section.heading ? `${section.heading} (${wordCount} words)` : `Section (${wordCount} words)`,
          position: section.startIndex,
          wordCount,
          domPath: section.domPath,
        },
      });
    } else {
      // Split large section into multiple chunks
      const subChunks = splitLargeSection(sectionText, section);
      chunks.push(...subChunks);
    }
  }

  // Sort section chunks by word count (descending - largest first)
  chunks.sort((a, b) => {
    // Only sort section chunks, keep other types in original order
    if (a.componentType === 'section' && b.componentType === 'section') {
      return b.metadata.wordCount - a.metadata.wordCount;
    }
    return 0;
  });

  return chunks;
}

// Split a very large paragraph into smaller pieces at sentence boundaries with overlap
function splitLargeParagraph(paragraph: string, maxChars: number, sentenceOverlap: number = 0): string[] {
  if (paragraph.length <= maxChars) {
    return [paragraph];
  }
  
  // First, split into sentences
  const sentenceMatches = paragraph.match(/([^.!?]+[.!?]+\s*)/g) || [];
  const sentences: string[] = [];
  for (let i = 0; i < sentenceMatches.length; i += 2) {
    const sentence = sentenceMatches[i] + (sentenceMatches[i + 1] || '');
    if (sentence.trim()) {
      sentences.push(sentence.trim());
    }
  }
  
  // If no sentence breaks found, fall back to word splitting
  if (sentences.length === 0) {
    const words = paragraph.split(/\s+/);
    const pieces: string[] = [];
    let currentPiece = '';
    
    for (const word of words) {
      if (currentPiece.length + word.length + 1 > maxChars && currentPiece) {
        pieces.push(currentPiece.trim());
        currentPiece = word;
      } else {
        currentPiece += (currentPiece ? ' ' : '') + word;
      }
    }
    if (currentPiece.trim()) {
      pieces.push(currentPiece.trim());
    }
    return pieces;
  }
  
  // Build chunks with sentence overlap for context preservation
  const pieces: string[] = [];
  let currentPiece = '';
  let startSentenceIndex = 0;
  
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const wouldExceed = currentPiece.length + sentence.length + (currentPiece ? ' ' : '').length > maxChars;
    
    if (wouldExceed && currentPiece) {
      // Save current chunk
      pieces.push(currentPiece.trim());
      
      // Start new chunk with overlap from previous chunk
      if (sentenceOverlap > 0 && i > 0) {
        const overlapStart = Math.max(0, i - sentenceOverlap);
        const overlapSentences = sentences.slice(overlapStart, i);
        currentPiece = overlapSentences.join(' ') + ' ' + sentence;
        startSentenceIndex = overlapStart;
      } else {
        currentPiece = sentence;
        startSentenceIndex = i;
      }
    } else {
      currentPiece += (currentPiece ? ' ' : '') + sentence;
    }
  }
  
  // Add final chunk
  if (currentPiece.trim()) {
    pieces.push(currentPiece.trim());
  }
  
  return pieces;
}

function splitLargeSection(text: string, section: Section): ContentChunk[] {
  const chunks: ContentChunk[] = [];
  
  // Split by double newlines, but preserve table data blocks
  // Tables are marked with [Table Data] markers
  const parts = text.split(/(\n\[Table Data\]\n[\s\S]*?\n\n)/);
  const paragraphs: string[] = [];
  
  // Reconstruct paragraphs and table blocks
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.includes('[Table Data]')) {
      // This is a table block - keep it together
      paragraphs.push(part.trim());
    } else {
      // Regular text - split by paragraphs
      const paraParts = part.split(/\n\n+/).filter(p => p.trim().length > 0);
      paragraphs.push(...paraParts);
    }
  }
  
  let currentChunk = '';
  let currentWordCount = 0;
  let currentCharCount = 0;
  let startPosition = section.startIndex;

  for (const paragraph of paragraphs) {
    // Preserve complete paragraphs - only split if extremely large
    // Table blocks are always preserved as complete units
    if (paragraph.includes('[Table Data]')) {
      // Table blocks should be kept together even if large
      // Save current chunk if it exists
      if (currentChunk.trim()) {
        chunks.push({
          id: uuidv4(),
          content: currentChunk.trim(),
          componentType: 'section',
          metadata: {
            sectionId: section.id,
            heading: section.heading ? `${section.heading} (${currentWordCount} words)` : `Section (${currentWordCount} words)`,
            position: startPosition,
            wordCount: currentWordCount,
            domPath: section.domPath,
          },
        });
        startPosition += currentChunk.length;
        currentChunk = '';
        currentWordCount = 0;
        currentCharCount = 0;
      }
      
      // Add table as complete chunk
      const tableWordCount = paragraph.split(/\s+/).filter(w => w.length > 0).length;
      chunks.push({
        id: uuidv4(),
        content: paragraph,
        componentType: 'table',
        metadata: {
          sectionId: section.id,
          heading: section.heading,
          position: startPosition,
          wordCount: tableWordCount,
          domPath: section.domPath,
        },
      });
      startPosition += paragraph.length;
      continue;
    }
    
    // Only split paragraphs if they exceed MAX_PARAGRAPH_CHARS (very large)
    // Otherwise, preserve them as complete semantic units
    if (paragraph.length > MAX_PARAGRAPH_CHARS) {
      // Save current chunk if it exists
      if (currentChunk.trim()) {
        chunks.push({
          id: uuidv4(),
          content: currentChunk.trim(),
          componentType: 'section',
          metadata: {
            sectionId: section.id,
            heading: section.heading ? `${section.heading} (${currentWordCount} words)` : `Section (${currentWordCount} words)`,
            position: startPosition,
            wordCount: currentWordCount,
            domPath: section.domPath,
          },
        });
        startPosition += currentChunk.length;
        currentChunk = '';
        currentWordCount = 0;
        currentCharCount = 0;
      }
      
      // Split extremely large paragraph at sentence boundaries with overlap
      eventLogger.info('Chunking', `Splitting very large paragraph (${paragraph.length} chars) at sentence boundaries...`);
      const paragraphPieces = splitLargeParagraph(paragraph, MAX_CHUNK_CHARS, SENTENCE_OVERLAP);
      eventLogger.info('Chunking', `Split into ${paragraphPieces.length} chunks with sentence overlap`);
      for (let i = 0; i < paragraphPieces.length; i++) {
        const piece = paragraphPieces[i];
        const pieceWordCount = piece.split(/\s+/).filter(w => w.length > 0).length;
        chunks.push({
          id: uuidv4(),
          content: piece,
          componentType: 'section',
          metadata: {
            sectionId: section.id,
            heading: section.heading ? `${section.heading} (${pieceWordCount} words)` : `Section (${pieceWordCount} words)`,
            position: startPosition,
            wordCount: pieceWordCount,
            domPath: section.domPath,
          },
        });
        startPosition += piece.length;
      }
      continue;
    }
    
    const paraWordCount = paragraph.split(/\s+/).filter(w => w.length > 0).length;
    const paraCharCount = paragraph.length;
    const wouldExceedWords = currentWordCount + paraWordCount > MAX_CHUNK_SIZE;
    const wouldExceedChars = currentCharCount + paraCharCount > MAX_CHUNK_CHARS;
    
    // If adding this paragraph would exceed limits, save current chunk
    // But if this is a table block, try to keep it with previous content if possible
    const isTableBlock = paragraph.includes('[Table Data]');

    if ((wouldExceedWords || wouldExceedChars) && currentChunk) {
      // Save current chunk
      chunks.push({
        id: uuidv4(),
        content: currentChunk.trim(),
        componentType: 'section',
        metadata: {
          sectionId: section.id,
          heading: section.heading ? `${section.heading} (${currentWordCount} words)` : `Section (${currentWordCount} words)`,
          position: startPosition,
          wordCount: currentWordCount,
          domPath: section.domPath,
        },
      });

      // Start new chunk with overlap (unless it's a table block)
      if (!isTableBlock) {
        const overlap = getOverlapText(currentChunk, OVERLAP_WORDS);
        currentChunk = overlap + '\n\n' + paragraph;
      } else {
        // Table blocks should start fresh
        currentChunk = paragraph;
      }
      currentWordCount = currentChunk.split(/\s+/).filter(w => w.length > 0).length;
      currentCharCount = currentChunk.length;
      startPosition = section.startIndex + currentChunk.length;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      currentWordCount += paraWordCount;
      currentCharCount += paraCharCount;
    }
  }

  // Add final chunk
  if (currentChunk.trim()) {
    chunks.push({
      id: uuidv4(),
      content: currentChunk.trim(),
      componentType: 'section',
      metadata: {
        sectionId: section.id,
        heading: section.heading ? `${section.heading} (${currentWordCount} words)` : `Section (${currentWordCount} words)`,
        position: startPosition,
        wordCount: currentWordCount,
        domPath: section.domPath,
      },
    });
  }

  // Sort section chunks by word count (descending - largest first)
  chunks.sort((a, b) => {
    if (a.componentType === 'section' && b.componentType === 'section') {
      return b.metadata.wordCount - a.metadata.wordCount;
    }
    return 0;
  });

  return chunks;
}

function chunkByParagraphs(text: string): ContentChunk[] {
  const chunks: ContentChunk[] = [];
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 20);

  let currentChunk = '';
  let currentWordCount = 0;
  let currentCharCount = 0;
  let position = 0;

  for (const paragraph of paragraphs) {
    // Preserve complete paragraphs - only split if extremely large (exceeds MAX_PARAGRAPH_CHARS)
    // This ensures we don't lose semantic meaning by breaking paragraphs unnecessarily
    if (paragraph.length > MAX_PARAGRAPH_CHARS) {
      // Save current chunk if it exists
      if (currentChunk.trim()) {
        chunks.push({
          id: uuidv4(),
          content: currentChunk.trim(),
          componentType: 'text',
          metadata: {
            position,
            wordCount: currentWordCount,
          },
        });
        position += currentChunk.length;
        currentChunk = '';
        currentWordCount = 0;
        currentCharCount = 0;
      }
      
      // Split extremely large paragraph at sentence boundaries with overlap
      eventLogger.info('Chunking', `Splitting very large paragraph (${paragraph.length} chars) at sentence boundaries...`);
      const paragraphPieces = splitLargeParagraph(paragraph, MAX_CHUNK_CHARS, SENTENCE_OVERLAP);
      eventLogger.info('Chunking', `Split into ${paragraphPieces.length} chunks with sentence overlap`);
      for (let i = 0; i < paragraphPieces.length; i++) {
        const piece = paragraphPieces[i];
        const pieceWordCount = piece.split(/\s+/).filter(w => w.length > 0).length;
        chunks.push({
          id: uuidv4(),
          content: piece,
          componentType: 'text',
          metadata: {
            position,
            wordCount: pieceWordCount,
          },
        });
        position += piece.length;
      }
      continue;
    }
    
    const paraWordCount = paragraph.split(/\s+/).filter(w => w.length > 0).length;
    const paraCharCount = paragraph.length;
    const wouldExceedWords = currentWordCount + paraWordCount > MAX_CHUNK_SIZE;
    const wouldExceedChars = currentCharCount + paraCharCount > MAX_CHUNK_CHARS;

    if ((wouldExceedWords || wouldExceedChars) && currentChunk) {
      // Save current chunk
      chunks.push({
        id: uuidv4(),
        content: currentChunk.trim(),
        componentType: 'text',
        metadata: {
          position,
          wordCount: currentWordCount,
        },
      });

      // Start new chunk with overlap
      const overlap = getOverlapText(currentChunk, OVERLAP_WORDS);
      currentChunk = overlap + '\n\n' + paragraph;
      currentWordCount = currentChunk.split(/\s+/).filter(w => w.length > 0).length;
      currentCharCount = currentChunk.length;
      position += currentChunk.length;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      currentWordCount += paraWordCount;
      currentCharCount += paraCharCount;
    }
  }

  // Add final chunk
  if (currentChunk.trim()) {
    chunks.push({
      id: uuidv4(),
      content: currentChunk.trim(),
      componentType: 'text',
      metadata: {
        position,
        wordCount: currentWordCount,
      },
    });
  }

  return chunks;
}

function getOverlapText(text: string, wordCount: number): string {
  const words = text.split(/\s+/);
  if (words.length <= wordCount) {
    return text;
  }
  return words.slice(-wordCount).join(' ');
}

// Extract structure from HTML content
export function extractStructure(htmlContent: string, textContent: string): {
  sections: Section[];
  headings: Heading[];
} {
  const sections: Section[] = [];
  const headings: Heading[] = [];

  // Simple regex-based extraction (can be enhanced with proper HTML parsing)
  const headingRegex = /<(h[1-6])[^>]*>(.*?)<\/h[1-6]>/gi;
  let match;
  let currentSection: Section | null = null;
  let sectionIndex = 0;

  while ((match = headingRegex.exec(htmlContent)) !== null) {
    const level = parseInt(match[1].substring(1));
    const headingText = match[2].replace(/<[^>]+>/g, '').trim();
    
    if (!headingText) continue; // Skip empty headings
    
    // Find heading position in text content
    let position = textContent.indexOf(headingText);
    
    // If not found, try searching case-insensitively
    if (position === -1) {
      const lowerText = textContent.toLowerCase();
      const lowerHeading = headingText.toLowerCase();
      const lowerPos = lowerText.indexOf(lowerHeading);
      if (lowerPos !== -1) {
        position = lowerPos;
      }
    }

    if (position !== -1) {
      headings.push({
        level,
        text: headingText,
        position,
      });

      // Close previous section and extract its content
      if (currentSection) {
        // Content is everything from after the previous heading to before this heading
        // Find the actual heading text in the content to get the correct end position
        const headingText = currentSection.heading || '';
        const headingPos = textContent.indexOf(headingText, currentSection.startIndex);
        const prevHeadingEnd = headingPos !== -1 
          ? headingPos + headingText.length 
          : currentSection.startIndex;
        currentSection.endIndex = position;
        currentSection.content = textContent.substring(
          prevHeadingEnd,
          position
        ).trim();
        sections.push(currentSection);
      }

      // Start new section
      currentSection = {
        id: `section-${sectionIndex++}`,
        heading: headingText,
        level,
        startIndex: position,
        endIndex: textContent.length, // Will be updated when next section starts
        content: '', // Will be populated when section closes
      };
    }
  }

  // Close final section
  if (currentSection) {
    // Content is everything from after the heading to the end
    // Find the actual heading text in the content to get the correct start position
    const headingText = currentSection.heading || '';
    const headingPos = textContent.indexOf(headingText, currentSection.startIndex);
    const headingEnd = headingPos !== -1 
      ? headingPos + headingText.length 
      : currentSection.startIndex;
    currentSection.endIndex = textContent.length;
    currentSection.content = textContent.substring(
      headingEnd,
      textContent.length
    ).trim();
    sections.push(currentSection);
  }

  // If no sections found, create one big section
  if (sections.length === 0) {
    sections.push({
      id: 'section-0',
      startIndex: 0,
      endIndex: textContent.length,
      content: textContent,
      level: 0,
    });
  }

  return { sections, headings };
}

/**
 * Create component-aware chunks
 */
function chunkByComponents(
  text: string,
  sections: Section[],
  components: DOMComponent[]
): ContentChunk[] {
  const chunks: ContentChunk[] = [];

  // Group components by type and create chunks
  const forms = components.filter(c => c.type === 'form');
  const buttons = components.filter(c => c.type === 'button' && !c.metadata.formId);
  const tables = components.filter(c => c.type === 'table');
  const inputGroups = components.filter(c => c.type === 'input-group');

  // Create chunks for forms (include nested input-group and button chunks)
  forms.forEach(form => {
    const formInputs = inputGroups.filter(i => i.metadata.formId === form.id);
    const formButtons = components.filter(c => c.metadata.formId === form.id && c.type === 'button');
    
    // Create nested chunks for inputs
    const nestedInputChunks: ContentChunk[] = formInputs.map(input => ({
      id: uuidv4(),
      content: `Input Field: ${input.metadata.label || input.attributes.placeholder || input.attributes.name || 'Input'}\nType: ${input.attributes.type || 'text'}\nSelector: ${input.selector}${input.metadata.required ? '\nRequired: Yes' : ''}${input.metadata.placeholder ? `\nPlaceholder: ${input.metadata.placeholder}` : ''}`,
      componentType: 'input-group',
      componentData: input,
      metadata: {
        heading: input.metadata.label || input.attributes.name || 'Input',
        position: 0,
        wordCount: 10, // Approximate
        domPath: input.selector,
      },
    }));
    
    // Create nested chunks for buttons
    const nestedButtonChunks: ContentChunk[] = formButtons.map(button => ({
      id: uuidv4(),
      content: `Button: ${button.textContent}\nSelector: ${button.selector}\nType: ${button.attributes.type || 'submit'}`,
      componentType: 'button',
      componentData: button,
      metadata: {
        heading: button.textContent,
        position: 0,
        wordCount: 5, // Approximate
        domPath: button.selector,
      },
    }));
    
    // Build comprehensive form description with semantic context for better embedding
    // Start with semantic description (what the form is for) - this is what gets embedded
    let formContent = '';
    
    // Priority 1: Use semantic purpose/heading if available
    if (form.metadata.formPurpose) {
      formContent += `${form.metadata.formPurpose}\n`;
    }
    if (form.metadata.formHeading) {
      formContent += `Heading: ${form.metadata.formHeading}\n`;
    }
    if (form.metadata.formDescription) {
      formContent += `Description: ${form.metadata.formDescription}\n`;
    }
    
    // Priority 2: Use form text content (which now includes semantic info)
    if (form.textContent && form.textContent.trim().length > 0) {
      formContent += `Form: ${form.textContent}\n`;
    }
    
    // Add field descriptions in natural language for semantic matching
    formContent += `\nThis form has the following fields:\n`;
    formInputs.forEach(input => {
      const label = input.metadata.label || input.attributes.placeholder || input.attributes.name || 'input field';
      const type = input.attributes.type || 'text';
      let fieldDesc = label;
      
      // Add type context for better semantic matching
      if (type === 'email') {
        fieldDesc = `email address for ${label}`;
      } else if (type === 'date') {
        fieldDesc = `date selection for ${label}`;
      } else if (type === 'number' || type === 'tel') {
        fieldDesc = `number for ${label}`;
      }
      
      formContent += `- ${fieldDesc}`;
      if (input.metadata.required) {
        formContent += ' (required)';
      }
      formContent += '\n';
    });
    
    // Add technical details (for tool execution, not primary for embedding)
    formContent += `\nTechnical Details:\n`;
    formContent += `Selector: ${form.selector}\n`;
    if (form.attributes.action) {
      formContent += `Action: ${form.attributes.action}\n`;
    }
    if (form.attributes.method) {
      formContent += `Method: ${form.attributes.method}\n`;
    }
    formContent += `\nInput Fields (${formInputs.length}):\n`;
    
    formInputs.forEach(input => {
      formContent += `- ${input.metadata.label || input.attributes.placeholder || input.attributes.name || 'Input'}`;
      if (input.attributes.type) {
        formContent += ` (${input.attributes.type})`;
      }
      if (input.metadata.required) {
        formContent += ' [required]';
      }
      formContent += `\n  Selector: ${input.selector}\n`;
    });
    
    if (formButtons.length > 0) {
      formContent += '\nButtons:\n';
      formButtons.forEach(button => {
        formContent += `- ${button.textContent} (${button.selector})\n`;
      });
    }

    // Create form chunk with nested chunks
    chunks.push({
      id: uuidv4(),
      content: formContent.trim(),
      componentType: 'form',
      componentData: form,
      nestedChunks: [...nestedInputChunks, ...nestedButtonChunks], // Include all nested components
      metadata: {
        heading: form.textContent,
        position: 0, // Will be calculated if needed
        wordCount: formContent.split(/\s+/).length,
        domPath: form.selector,
      },
    });
  });

  // Create chunks for standalone buttons (not part of any form)
  const standaloneButtons = buttons.filter(b => !b.metadata.formId);
  standaloneButtons.forEach(button => {
    const buttonContent = `Button: ${button.textContent}\nSelector: ${button.selector}`;
    
    chunks.push({
      id: uuidv4(),
      content: buttonContent,
      componentType: 'button',
      componentData: button,
      metadata: {
        heading: button.textContent,
        position: 0,
        wordCount: buttonContent.split(/\s+/).length,
        domPath: button.selector,
      },
    });
  });

  // Create chunks for tables
  tables.forEach(table => {
    const tableContent = `Table Data:\n${table.textContent}\n\nSelector: ${table.selector}`;
    
    chunks.push({
      id: uuidv4(),
      content: tableContent,
      componentType: 'table',
      componentData: table,
      metadata: {
        heading: 'Table',
        position: 0,
        wordCount: tableContent.split(/\s+/).length,
        domPath: table.selector,
      },
    });
  });

  return chunks;
}


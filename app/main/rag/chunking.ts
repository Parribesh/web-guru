import { ContentChunk, PageContent, Section, Heading } from '../../shared/types';
import { v4 as uuidv4 } from 'uuid';
import { eventLogger } from '../logging/event-logger';

const MIN_CHUNK_SIZE = 100; // Minimum words per chunk
const MAX_CHUNK_SIZE = 200; // Maximum words per chunk (~800 chars)
const MAX_CHUNK_CHARS = 800; // Increased from 400 to 800 for larger chunks (reduces total chunk count)
const OVERLAP_WORDS = 50; // Words to overlap between chunks

export function chunkContent(pageContent: PageContent): ContentChunk[] {
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

  // Strategy 1: Section-based chunking (preferred)
  if (structure.sections.length > 0) {
    chunks.push(...chunkBySections(extractedText, structure.sections));
  } else {
    // Strategy 2: Paragraph-based with overlap (fallback)
    chunks.push(...chunkByParagraphs(extractedText));
  }
  
  // Log chunk info for debugging
  chunks.forEach((chunk, idx) => {
    const contentLength = chunk.content ? chunk.content.length : 0;
    const wordCount = chunk.content ? chunk.content.split(/\s+/).length : 0;
    if (contentLength === 0) {
      eventLogger.warning('Chunking', `Chunk ${idx + 1} has no content! Heading: "${chunk.metadata.heading || 'No heading'}"`);
    } else if (contentLength > MAX_CHUNK_CHARS) {
      eventLogger.warning('Chunking', `Chunk ${idx + 1} exceeds size limit: ${contentLength} chars (max ${MAX_CHUNK_CHARS}). Heading: "${chunk.metadata.heading || 'No heading'}"`);
    }
  });

  // Add metadata to chunks
  const finalChunks = chunks.map((chunk, index) => ({
    ...chunk,
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
        metadata: {
          sectionId: section.id,
          heading: section.heading,
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

  return chunks;
}

// Split a very large paragraph into smaller pieces at sentence boundaries
function splitLargeParagraph(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) {
    return [paragraph];
  }
  
  const pieces: string[] = [];
  const sentences = paragraph.split(/([.!?]+\s+)/);
  let currentPiece = '';
  
  for (let i = 0; i < sentences.length; i += 2) {
    const sentence = sentences[i] + (sentences[i + 1] || '');
    
    if (currentPiece.length + sentence.length > maxChars && currentPiece) {
      pieces.push(currentPiece.trim());
      currentPiece = sentence;
    } else {
      currentPiece += sentence;
    }
  }
  
  if (currentPiece.trim()) {
    pieces.push(currentPiece.trim());
  }
  
  // If still too large (no sentence breaks), split by words
  const finalPieces: string[] = [];
  for (const piece of pieces) {
    if (piece.length <= maxChars) {
      finalPieces.push(piece);
    } else {
      // Split by words as last resort
      const words = piece.split(/\s+/);
      let wordChunk = '';
      for (const word of words) {
        if (wordChunk.length + word.length + 1 > maxChars && wordChunk) {
          finalPieces.push(wordChunk.trim());
          wordChunk = word;
        } else {
          wordChunk += (wordChunk ? ' ' : '') + word;
        }
      }
      if (wordChunk.trim()) {
        finalPieces.push(wordChunk.trim());
      }
    }
  }
  
  return finalPieces;
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
    // If paragraph itself is too large, split it first
    if (paragraph.length > MAX_CHUNK_CHARS) {
      // Save current chunk if it exists
      if (currentChunk.trim()) {
        chunks.push({
          id: uuidv4(),
          content: currentChunk.trim(),
          metadata: {
            sectionId: section.id,
            heading: section.heading,
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
      
      // Split large paragraph into multiple chunks
      // But preserve table blocks - don't split them
      if (paragraph.includes('[Table Data]')) {
        // Table blocks should be kept together even if large
        // Just add it as a single chunk
        const tableWordCount = paragraph.split(/\s+/).filter(w => w.length > 0).length;
        chunks.push({
          id: uuidv4(),
          content: paragraph,
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
      
      eventLogger.info('Chunking', `Splitting large paragraph (${paragraph.length} chars) into smaller chunks...`);
      const paragraphPieces = splitLargeParagraph(paragraph, MAX_CHUNK_CHARS);
      eventLogger.info('Chunking', `Split into ${paragraphPieces.length} chunks`);
      for (let i = 0; i < paragraphPieces.length; i++) {
        const piece = paragraphPieces[i];
        const pieceWordCount = piece.split(/\s+/).filter(w => w.length > 0).length;
        chunks.push({
          id: uuidv4(),
          content: piece,
          metadata: {
            sectionId: section.id,
            heading: section.heading,
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
        metadata: {
          sectionId: section.id,
          heading: section.heading,
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
      metadata: {
        sectionId: section.id,
        heading: section.heading,
        position: startPosition,
        wordCount: currentWordCount,
        domPath: section.domPath,
      },
    });
  }

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
    // If paragraph itself is too large, split it first
    if (paragraph.length > MAX_CHUNK_CHARS) {
      // Save current chunk if it exists
      if (currentChunk.trim()) {
        chunks.push({
          id: uuidv4(),
          content: currentChunk.trim(),
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
      
      // Split large paragraph into multiple chunks
      const paragraphPieces = splitLargeParagraph(paragraph, MAX_CHUNK_CHARS);
      for (let i = 0; i < paragraphPieces.length; i++) {
        const piece = paragraphPieces[i];
        const pieceWordCount = piece.split(/\s+/).filter(w => w.length > 0).length;
        chunks.push({
          id: uuidv4(),
          content: piece,
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


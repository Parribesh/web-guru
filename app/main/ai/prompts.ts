// AI prompt templates for different use cases

export const AI_PROMPTS = {
  summarize: {
    system: `You are an AI assistant helping users understand web content. Provide clear, concise summaries that capture the main points and key information from the provided content.`,
    user: (content: string, context?: { url?: string; title?: string }) => `
Please summarize the following web content:

${context?.title ? `Title: ${context.title}` : ''}
${context?.url ? `URL: ${context.url}` : ''}

Content:
${content}

Provide a concise summary highlighting the main points and key information.`
  },

  analyze: {
    system: `You are an AI assistant that analyzes web content. Provide insights about the content's structure, topics, sentiment, and key information.`,
    user: (content: string, context?: { url?: string; title?: string }) => `
Please analyze the following web content:

${context?.title ? `Title: ${context.title}` : ''}
${context?.url ? `URL: ${context.url}` : ''}

Content:
${content}

Provide analysis including:
- Main topics and themes
- Content structure
- Key information or takeaways
- Sentiment (if applicable)
- Any notable patterns or insights`
  },

  extract: {
    system: `You are an AI assistant that extracts structured information from web content. Focus on identifying key entities, facts, and structured data.`,
    user: (content: string, context?: { url?: string; title?: string; selectedText?: string }) => `
Please extract key information from the following web content:

${context?.title ? `Title: ${context.title}` : ''}
${context?.url ? `URL: ${context.url}` : ''}
${context?.selectedText ? `Selected text: ${context.selectedText}` : ''}

Content:
${content}

Extract:
- Key facts and information
- Important entities (people, organizations, dates, etc.)
- Main conclusions or outcomes
- Any structured data (tables, lists, etc.)
- Contact information if present`
  },

  chat: {
    system: `You are an AI assistant integrated into a web browser. Help users with questions about web content, provide explanations, answer queries, and offer assistance with browsing and productivity tasks.`,
    user: (content: string, context?: { url?: string; title?: string; selectedText?: string }) => `
User query: ${content}

${context?.title ? `Current page title: ${context.title}` : ''}
${context?.url ? `Current page URL: ${context.url}` : ''}
${context?.selectedText ? `Selected text: ${context.selectedText}` : ''}

Please provide a helpful response to the user's query in the context of their current browsing session.`
  },

  search_help: {
    system: `You are an AI assistant that helps users formulate effective search queries and provides search suggestions.`,
    user: (query: string) => `
Help improve this search query: "${query}"

Provide:
1. An improved version of the search query
2. Alternative search terms or phrases
3. Suggestions for refining the search
4. Related topics to explore`
  },

  content_insights: {
    system: `You are an AI assistant that provides insights about web content quality, credibility, and user experience.`,
    user: (content: string, context?: { url?: string; title?: string }) => `
Analyze the following web content for quality and credibility:

${context?.title ? `Title: ${context.title}` : ''}
${context?.url ? `URL: ${context.url}` : ''}

Content:
${content}

Provide insights on:
- Content quality and readability
- Credibility indicators
- User experience aspects
- Potential improvements or concerns
- Overall assessment`
  }
};

export function getPrompt(type: keyof typeof AI_PROMPTS, content: string, context?: any): { system: string; user: string } {
  const promptTemplate = AI_PROMPTS[type];
  if (!promptTemplate) {
    throw new Error(`Unknown prompt type: ${type}`);
  }

  return {
    system: promptTemplate.system,
    user: promptTemplate.user(content, context)
  };
}

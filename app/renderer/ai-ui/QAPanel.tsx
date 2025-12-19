import React, { useState } from 'react';
import { QARequest, QAResponse } from '../../shared/types';

interface QAPanelProps {
  tabId: string;
  pageTitle?: string;
  pageUrl?: string;
}

export const QAPanel: React.FC<QAPanelProps> = ({ tabId, pageTitle, pageUrl }) => {
  const [question, setQuestion] = useState('');
  const [response, setResponse] = useState<QAResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);
    setResponse(null);

    try {
      const request: QARequest = {
        question: question.trim(),
        tabId,
        context: {
          url: pageUrl || '',
          title: pageTitle || '',
        },
      };

      const qaResponse = await ((window as any).electronAPI?.qa?.ask(request) || Promise.resolve(null));
      setResponse(qaResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get answer');
      console.error('QA error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="qa-panel p-4 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
      <h2 className="text-xl font-bold mb-4">Ask about this page</h2>
      
      {pageTitle && (
        <div className="mb-3 text-sm text-gray-600 dark:text-gray-400">
          <p className="font-semibold">{pageTitle}</p>
          {pageUrl && <p className="text-xs truncate">{pageUrl}</p>}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mb-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about this page..."
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                     bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100
                     focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !question.trim()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg 
                     hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed
                     transition-colors"
          >
            {isLoading ? '...' : 'Ask'}
          </button>
        </div>
      </form>

      {error && (
        <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded">
          {error}
        </div>
      )}

      {response && (
        <div className="qa-response">
          {response.success ? (
            <>
              <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
                <h3 className="font-semibold mb-2 text-blue-900 dark:text-blue-100">Answer</h3>
                <p className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                  {response.answer}
                </p>
              </div>

              {response.relevantChunks.length > 0 && (
                <div className="mb-4">
                  <h3 className="font-semibold mb-2 text-gray-700 dark:text-gray-300">
                    Relevant Sections ({response.relevantChunks.length})
                  </h3>
                  <div className="space-y-2">
                    {response.relevantChunks.map((chunk, index) => (
                      <div
                        key={chunk.chunkId}
                        className="p-3 bg-gray-50 dark:bg-gray-700 rounded border-l-4 border-blue-500"
                      >
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                          {chunk.relevance}
                        </div>
                        <p className="text-sm text-gray-700 dark:text-gray-300">
                          {chunk.excerpt}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {response.metadata && (
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Confidence: {(response.confidence * 100).toFixed(0)}% • 
                  Processed in {response.metadata.processingTime}ms
                </div>
              )}
            </>
          ) : (
            <div className="p-3 bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 rounded">
              {response.error || 'Failed to generate answer'}
            </div>
          )}
        </div>
      )}
    </div>
  );
};



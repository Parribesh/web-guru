import React, { useState } from 'react';
import { AISidePanelProps, AIRequest } from '../../shared/types';

export const AISidePanel: React.FC<AISidePanelProps> = ({
  isOpen,
  onToggle,
  onRequest,
  currentResponse,
  isProcessing
}) => {
  const [inputText, setInputText] = useState('');
  const [requestType, setRequestType] = useState<AIRequest['type']>('chat');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const request: AIRequest = {
      type: requestType,
      content: inputText.trim()
    };

    await onRequest(request);
    setInputText('');
  };

  const handleQuickAction = async (type: AIRequest['type']) => {
    const request: AIRequest = {
      type,
      content: '' // Content will be extracted from current page
    };
    await onRequest(request);
  };

  return (
    <>
      <div className={`fixed top-0 right-0 h-full w-[380px] bg-white border-l border-gray-200 shadow-xl transform transition-transform duration-200 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="text-base font-semibold text-gray-900">AI Assistant</div>
          <button
            className="w-8 h-8 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-100"
            onClick={onToggle}
            title="Toggle AI panel"
          >
            ✕
          </button>
        </div>

        <div className="p-4 flex flex-col h-[calc(100%-56px)]">
          <div className="space-y-3">
            <select
              className="w-full h-10 border border-gray-300 rounded-md px-2 text-sm"
              value={requestType}
              onChange={(e) => setRequestType(e.target.value as AIRequest['type'])}
            >
              <option value="chat">Chat</option>
              <option value="summarize">Summarize Page</option>
              <option value="analyze">Analyze Content</option>
              <option value="extract">Extract Information</option>
            </select>

            <form onSubmit={handleSubmit}>
              <textarea
                className="w-full min-h-[90px] border border-gray-300 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={
                  requestType === 'chat'
                    ? 'Ask me anything about this page...'
                    : requestType === 'summarize'
                    ? 'Describe what you want summarized...'
                    : requestType === 'analyze'
                    ? 'What aspects should I analyze...'
                    : 'What information should I extract...'
                }
                disabled={isProcessing}
              />
            </form>
          </div>

          <div className="flex gap-2 mt-3">
            <button
              className="flex-1 h-9 border border-gray-300 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50"
              onClick={() => handleQuickAction('summarize')}
              disabled={isProcessing}
            >
              📝 Summarize
            </button>
            <button
              className="flex-1 h-9 border border-gray-300 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50"
              onClick={() => handleQuickAction('analyze')}
              disabled={isProcessing}
            >
              🔍 Analyze
            </button>
            <button
              className="flex-1 h-9 border border-gray-300 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50"
              onClick={() => handleQuickAction('extract')}
              disabled={isProcessing}
            >
              📋 Extract
            </button>
          </div>

          <div className="flex-1 mt-4 overflow-auto">
            {isProcessing && (
              <div className="text-sm text-gray-600">Processing...</div>
            )}

            {currentResponse && (
              <div className="text-sm bg-gray-50 border border-gray-200 rounded-md p-3 space-y-2">
                {currentResponse.error ? (
                  <div className="text-red-600">
                    Error: {currentResponse.error}
                  </div>
                ) : (
                  <div className="text-gray-800 whitespace-pre-wrap">
                    {currentResponse.content}
                  </div>
                )}

                {currentResponse.metadata && (
                  <div className="pt-2 border-t border-gray-200 text-xs text-gray-500 space-y-1">
                    {currentResponse.metadata.model && (
                      <div>Model: {currentResponse.metadata.model}</div>
                    )}
                    {currentResponse.metadata.processingTime && (
                      <div>Time: {Math.round(currentResponse.metadata.processingTime)}ms</div>
                    )}
                    {currentResponse.metadata.tokens && (
                      <div>Tokens: {currentResponse.metadata.tokens}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

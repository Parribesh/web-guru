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
      <div className={`ai-panel ${isOpen ? 'open' : ''}`}>
        <div className="ai-panel-header">
          <h3 className="ai-panel-title">AI Assistant</h3>
          <button
            className="ai-panel-toggle"
            onClick={onToggle}
            title="Toggle AI panel"
          >
            ✕
          </button>
        </div>

        <div className="ai-panel-content">
          <div className="ai-input-area">
            <select
              value={requestType}
              onChange={(e) => setRequestType(e.target.value as AIRequest['type'])}
              style={{
                width: '100%',
                padding: '8px',
                marginBottom: '8px',
                border: '1px solid #ced4da',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            >
              <option value="chat">Chat</option>
              <option value="summarize">Summarize Page</option>
              <option value="analyze">Analyze Content</option>
              <option value="extract">Extract Information</option>
            </select>

            <form onSubmit={handleSubmit}>
              <textarea
                className="ai-textarea"
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

          <div className="ai-action-buttons">
            <button
              className="ai-btn"
              onClick={() => handleQuickAction('summarize')}
              disabled={isProcessing}
            >
              📝 Summarize
            </button>
            <button
              className="ai-btn"
              onClick={() => handleQuickAction('analyze')}
              disabled={isProcessing}
            >
              🔍 Analyze
            </button>
            <button
              className="ai-btn"
              onClick={() => handleQuickAction('extract')}
              disabled={isProcessing}
            >
              📋 Extract
            </button>
          </div>

          {isProcessing && (
            <div className="ai-loading">
              <div>Processing...</div>
            </div>
          )}

          {currentResponse && (
            <div className="ai-response">
              {currentResponse.error ? (
                <div style={{ color: '#dc3545' }}>
                  Error: {currentResponse.error}
                </div>
              ) : (
                <div>
                  {currentResponse.content}
                  {currentResponse.metadata && (
                    <div style={{
                      marginTop: '8px',
                      fontSize: '12px',
                      color: '#6c757d',
                      borderTop: '1px solid #e0e0e0',
                      paddingTop: '8px'
                    }}>
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
          )}
        </div>
      </div>
    </>
  );
};

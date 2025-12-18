import React, { useState } from 'react';
import { AIResponse } from '../../shared/types';

type ChatMessage = { from: 'user' | 'ai'; content: string };

interface AIChatPanelProps {
  messages: ChatMessage[];
  onSend: (text: string) => Promise<AIResponse | null>;
  isProcessing: boolean;
  hasActiveTab: boolean;
}

export const AIChatPanel: React.FC<AIChatPanelProps> = ({
  messages,
  onSend,
  isProcessing,
  hasActiveTab
}) => {
  const [input, setInput] = useState('');

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !hasActiveTab) return;
    setInput('');
    await onSend(text);
  };

  return (
    <div className="ai-chat">
      <div className="ai-chat__header">
        <div>
          <div className="ai-chat__title">AI Copilot</div>
          <div className="ai-chat__subtitle">Plan, browse, and fill forms</div>
        </div>
        <button
          className="ai-chat__action"
          onClick={() => setInput('')}
          disabled={!hasActiveTab}
        >
          New task
        </button>
      </div>

      <div className="ai-chat__body space-y-2 overflow-y-auto">
        {messages.length === 0 && (
          <div className="ai-chat__placeholder">
            Conversation will appear here. Ask the agent to navigate, extract data,
            fill forms, or book a flight.
          </div>
        )}
        {messages.map((m, idx) => (
          <div
            key={idx}
            className={`px-3 py-2 rounded-md text-sm ${
              m.from === 'user' ? 'bg-blue-50 text-gray-900' : 'bg-gray-100 text-gray-800'
            }`}
          >
            <span className="font-semibold mr-1">{m.from === 'user' ? 'You:' : 'AI:'}</span>
            {m.content}
          </div>
        ))}
        {isProcessing && (
          <div className="text-xs text-gray-500">Thinking...</div>
        )}
      </div>

      <div className="ai-chat__composer">
        <input
          className="ai-chat__input"
          placeholder="Ask the AI to browse or perform a task..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={!hasActiveTab || isProcessing}
        />
        <button
          className="ai-chat__send disabled:opacity-50"
          onClick={handleSend}
          disabled={!hasActiveTab || isProcessing}
        >
          Send
        </button>
      </div>
    </div>
  );
};


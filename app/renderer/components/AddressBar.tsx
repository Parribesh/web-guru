import React, { useState, useEffect } from 'react';
import { AddressBarProps } from '../../shared/types';

export const AddressBar: React.FC<AddressBarProps> = ({
  url,
  isLoading,
  canGoBack,
  canGoForward,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onStop
}) => {
  const [inputValue, setInputValue] = useState(url);

  // Update input value when URL changes
  useEffect(() => {
    setInputValue(url);
  }, [url]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUrl = inputValue.trim();
    if (trimmedUrl) {
      onNavigate(trimmedUrl);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit(e);
    }
  };

  return (
    <div className="h-12 bg-white border-b border-gray-200 flex items-center px-3 gap-2 shadow-sm">
      <button
        className="w-9 h-9 rounded-md bg-gray-100 text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center hover:bg-gray-200 transition-colors text-sm font-medium"
        onClick={onBack}
        disabled={!canGoBack}
        title="Go back"
      >
        ←
      </button>

      <button
        className="w-9 h-9 rounded-md bg-gray-100 text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center hover:bg-gray-200 transition-colors text-sm font-medium"
        onClick={onForward}
        disabled={!canGoForward}
        title="Go forward"
      >
        →
      </button>

      <button
        className="w-9 h-9 rounded-md bg-gray-100 text-gray-700 flex items-center justify-center hover:bg-gray-200 transition-colors text-sm font-medium"
        onClick={isLoading ? onStop : onReload}
        title={isLoading ? 'Stop loading' : 'Reload'}
      >
        {isLoading ? '✕' : '↻'}
      </button>

      <form onSubmit={handleSubmit} className="flex-1 flex gap-2">
        <input
          type="text"
          className="flex-1 h-9 px-4 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter URL or search..."
          spellCheck={false}
        />
        <button
          type="submit"
          className="px-5 h-9 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors shadow-sm"
          title="Load URL"
        >
          Go
        </button>
      </form>
    </div>
  );
};

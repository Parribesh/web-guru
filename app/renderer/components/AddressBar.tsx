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
    <div className="h-12 bg-white border-b border-gray-200 flex items-center px-4 gap-2">
      <button
        className="w-8 h-8 rounded-md bg-gray-100 text-gray-600 disabled:opacity-50 flex items-center justify-center hover:bg-gray-200"
        onClick={onBack}
        disabled={!canGoBack}
        title="Go back"
      >
        ←
      </button>

      <button
        className="w-8 h-8 rounded-md bg-gray-100 text-gray-600 disabled:opacity-50 flex items-center justify-center hover:bg-gray-200"
        onClick={onForward}
        disabled={!canGoForward}
        title="Go forward"
      >
        →
      </button>

      <button
        className="w-8 h-8 rounded-md bg-gray-100 text-gray-600 flex items-center justify-center hover:bg-gray-200"
        onClick={isLoading ? onStop : onReload}
        title={isLoading ? 'Stop loading' : 'Reload'}
      >
        {isLoading ? '✕' : '↻'}
      </button>

      <form onSubmit={handleSubmit} className="flex-1 flex gap-2">
        <input
          type="text"
          className="w-full h-10 px-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search or enter URL"
          spellCheck={false}
        />
        <button
          type="submit"
          className="px-4 h-10 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          title="Load URL"
        >
          Fetch
        </button>
      </form>
    </div>
  );
};

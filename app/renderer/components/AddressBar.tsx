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
    <div className="address-bar">
      <button
        className="nav-btn"
        onClick={onBack}
        disabled={!canGoBack}
        title="Go back"
      >
        ←
      </button>

      <button
        className="nav-btn"
        onClick={onForward}
        disabled={!canGoForward}
        title="Go forward"
      >
        →
      </button>

      <button
        className="nav-btn"
        onClick={isLoading ? onStop : onReload}
        title={isLoading ? 'Stop loading' : 'Reload'}
      >
        {isLoading ? '✕' : '↻'}
      </button>

      <form onSubmit={handleSubmit} style={{ flex: 1, display: 'flex' }}>
        <input
          type="text"
          className="url-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search or enter URL"
          spellCheck={false}
        />
      </form>
    </div>
  );
};

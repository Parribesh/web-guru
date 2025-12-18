import React, { useState, useEffect, useMemo } from 'react';
import { Command } from '../../shared/types';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onCommand: (command: Command) => void;
}

// TODO: Implement full command system
const DEFAULT_COMMANDS: Command[] = [
  {
    id: 'new-tab',
    label: 'New Tab',
    description: 'Open a new tab',
    shortcut: 'Ctrl+T',
    action: () => {
      // TODO: Implement new tab
      console.log('New tab');
    }
  },
  {
    id: 'close-tab',
    label: 'Close Tab',
    description: 'Close current tab',
    shortcut: 'Ctrl+W',
    action: () => {
      // TODO: Implement close tab
      console.log('Close tab');
    }
  },
  {
    id: 'toggle-ai-panel',
    label: 'Toggle AI Panel',
    description: 'Show/hide AI assistant panel',
    shortcut: 'Ctrl+Shift+A',
    action: () => {
      // TODO: Implement AI panel toggle
      console.log('Toggle AI panel');
    }
  },
  {
    id: 'open-dev-tools',
    label: 'Open Dev Tools',
    description: 'Open developer tools',
    shortcut: 'F12',
    action: () => {
      // TODO: Implement dev tools
      console.log('Open dev tools');
    }
  },
  {
    id: 'reload-page',
    label: 'Reload Page',
    description: 'Reload current page',
    shortcut: 'Ctrl+R',
    action: () => {
      // TODO: Implement reload
      console.log('Reload page');
    }
  },
  {
    id: 'go-back',
    label: 'Go Back',
    description: 'Navigate to previous page',
    shortcut: 'Alt+←',
    action: () => {
      // TODO: Implement go back
      console.log('Go back');
    }
  },
  {
    id: 'go-forward',
    label: 'Go Forward',
    description: 'Navigate to next page',
    shortcut: 'Alt+→',
    action: () => {
      // TODO: Implement go forward
      console.log('Go forward');
    }
  }
];

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onCommand
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredCommands = useMemo(() => {
    if (!query.trim()) {
      return DEFAULT_COMMANDS;
    }

    const lowerQuery = query.toLowerCase();
    return DEFAULT_COMMANDS.filter(command =>
      command.label.toLowerCase().includes(lowerQuery) ||
      (command.description && command.description.toLowerCase().includes(lowerQuery))
    );
  }, [query]);

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev =>
          prev < filteredCommands.length - 1 ? prev + 1 : prev
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => prev > 0 ? prev - 1 : prev);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          onCommand(filteredCommands[selectedIndex]);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredCommands, selectedIndex, onClose, onCommand]);

  if (!isOpen) return null;

  return (
    <>
      <div className="command-palette-overlay open" onClick={onClose} />
      <div className="command-palette open">
        <input
          type="text"
          className="command-input"
          placeholder="Type a command..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0); // Reset selection when query changes
          }}
          autoFocus
        />

        <div className="command-list">
          {filteredCommands.map((command, index) => (
            <div
              key={command.id}
              className={`command-item ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => onCommand(command)}
            >
              <div className="command-info">
                <div className="command-title">{command.label}</div>
                <div className="command-description">{command.description || ''}</div>
              </div>
              {command.shortcut && (
                <div className="command-shortcut">{command.shortcut}</div>
              )}
            </div>
          ))}

          {filteredCommands.length === 0 && (
            <div className="command-item">
              <div className="command-info">
                <div className="command-title">No commands found</div>
                <div className="command-description">Try a different search term</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

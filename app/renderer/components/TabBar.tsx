import React from 'react';
import { TabBarProps } from '../../shared/types';

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onNewTab
}) => {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
          onClick={() => onTabClick(tab.id)}
        >
          {tab.favicon && (
            <img
              src={tab.favicon}
              alt=""
              className="tab-favicon"
              onError={(e) => {
                // Hide favicon if it fails to load
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <span className="tab-title">
            {tab.title || tab.url || 'New Tab'}
          </span>
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              onTabClose(tab.id);
            }}
            title="Close tab"
          >
            ✕
          </button>
        </div>
      ))}

      <button
        className="new-tab-btn"
        onClick={onNewTab}
        title="New tab"
      >
        +
      </button>
    </div>
  );
};

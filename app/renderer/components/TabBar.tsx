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
    <div className="flex items-center h-10 bg-gray-50 border-b border-gray-200 px-2 overflow-x-auto overflow-y-hidden">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`flex items-center h-8 min-w-[160px] max-w-[220px] px-3 mr-1 rounded-t-md cursor-pointer transition ${
            tab.id === activeTabId
              ? 'bg-white shadow-sm border border-gray-200 border-b-0'
              : 'bg-gray-100 hover:bg-gray-200 border border-transparent'
          }`}
          onClick={() => onTabClick(tab.id)}
        >
          {tab.favicon && (
            <img
              src={tab.favicon}
              alt=""
              className="w-4 h-4 mr-2 flex-shrink-0"
              onError={(e) => {
                // Hide favicon if it fails to load
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <span className="flex-1 text-sm text-gray-700 truncate">
            {tab.title || tab.url || 'New Tab'}
          </span>
          <button
            className="ml-2 w-4 h-4 text-xs text-gray-500 hover:text-white hover:bg-red-500 rounded-full flex items-center justify-center"
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
        className="w-8 h-8 ml-2 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-100 flex items-center justify-center"
        onClick={onNewTab}
        title="New tab"
      >
        +
      </button>
    </div>
  );
};

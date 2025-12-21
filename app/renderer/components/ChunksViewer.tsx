import React, { useState, useEffect } from 'react';
import { ContentChunk, ComponentType, DOMComponent } from '../../shared/types';

interface ChunksViewerProps {
  sessionId: string;
}

interface ChunksData {
  success: boolean;
  chunks: ContentChunk[];
  components?: DOMComponent[];
  pageContent?: {
    url: string;
    title: string;
  };
  error?: string;
}

const COMPONENT_TYPE_LABELS: Record<ComponentType, string> = {
  'form': 'Forms',
  'button': 'Buttons',
  'input-group': 'Input Fields',
  'table': 'Tables',
  'list': 'Lists',
  'text': 'Text',
  'section': 'Sections',
  'heading': 'Headings',
};

type SortOption = 'size-desc' | 'size-asc' | 'default';
type SizeFilter = { min?: number; max?: number };

export const ChunksViewer: React.FC<ChunksViewerProps> = ({ sessionId }) => {
  const [chunksData, setChunksData] = useState<ChunksData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ComponentType | 'all'>('all');
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('default');
  const [sizeFilter, setSizeFilter] = useState<SizeFilter>({});
  const [showSizeFilter, setShowSizeFilter] = useState(false);

  useEffect(() => {
    const loadChunks = async () => {
      setLoading(true);
      setError(null);
      
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI?.sessions) {
        setError('electronAPI not available');
        setLoading(false);
        return;
      }

      try {
        const data = await electronAPI.sessions.getChunks(sessionId);
        setChunksData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load chunks');
      } finally {
        setLoading(false);
      }
    };

    if (sessionId) {
      loadChunks();
    }
  }, [sessionId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Loading chunks...</div>
      </div>
    );
  }

  if (error || !chunksData || !chunksData.success) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-500">
          {error || chunksData?.error || 'Failed to load chunks'}
        </div>
      </div>
    );
  }

  const chunks = chunksData.chunks || [];
  
  // Group chunks by component type
  const chunksByType = new Map<ComponentType, ContentChunk[]>();
  chunks.forEach(chunk => {
    const type = chunk.componentType || 'text';
    if (!chunksByType.has(type)) {
      chunksByType.set(type, []);
    }
    chunksByType.get(type)!.push(chunk);
  });

  // Get available component types (excluding 'text' if it's the only one)
  const availableTypes = Array.from(chunksByType.keys()).filter(type => {
    if (type === 'text' && chunksByType.size > 1) {
      return false; // Hide text tab if there are other types
    }
    return chunksByType.get(type)!.length > 0;
  });

  // Get chunks for active tab
  const getActiveChunks = (): ContentChunk[] => {
    let filtered: ContentChunk[] = [];
    if (activeTab === 'all') {
      filtered = chunks;
    } else {
      filtered = chunksByType.get(activeTab) || [];
    }

    // Apply size filter
    if (sizeFilter.min !== undefined || sizeFilter.max !== undefined) {
      filtered = filtered.filter(chunk => {
        const wordCount = chunk.metadata.wordCount || 0;
        const min = sizeFilter.min ?? 0;
        const max = sizeFilter.max ?? Infinity;
        return wordCount >= min && wordCount <= max;
      });
    }

    // Apply sorting
    if (sortBy === 'size-desc') {
      filtered = [...filtered].sort((a, b) => (b.metadata.wordCount || 0) - (a.metadata.wordCount || 0));
    } else if (sortBy === 'size-asc') {
      filtered = [...filtered].sort((a, b) => (a.metadata.wordCount || 0) - (b.metadata.wordCount || 0));
    }
    // 'default' keeps original order

    return filtered;
  };

  const activeChunks = getActiveChunks();

  // Calculate statistics for active chunks
  const calculateStats = (chunks: ContentChunk[]) => {
    if (chunks.length === 0) {
      return {
        totalWords: 0,
        averageSize: 0,
        minSize: 0,
        maxSize: 0,
        medianSize: 0,
        totalChunks: 0,
      };
    }

    const wordCounts = chunks.map(chunk => chunk.metadata.wordCount || 0).filter(count => count > 0);
    const totalWords = wordCounts.reduce((sum, count) => sum + count, 0);
    const averageSize = wordCounts.length > 0 ? Math.round(totalWords / wordCounts.length) : 0;
    const minSize = wordCounts.length > 0 ? Math.min(...wordCounts) : 0;
    const maxSize = wordCounts.length > 0 ? Math.max(...wordCounts) : 0;
    
    // Calculate median
    const sortedCounts = [...wordCounts].sort((a, b) => a - b);
    const medianSize = sortedCounts.length > 0
      ? sortedCounts.length % 2 === 0
        ? Math.round((sortedCounts[sortedCounts.length / 2 - 1] + sortedCounts[sortedCounts.length / 2]) / 2)
        : sortedCounts[Math.floor(sortedCounts.length / 2)]
      : 0;

    return {
      totalWords,
      averageSize,
      minSize,
      maxSize,
      medianSize,
      totalChunks: chunks.length,
    };
  };

  const stats = calculateStats(activeChunks);
  
  // Get section chunks for section-specific stats
  const sectionChunks = chunksByType.get('section') || [];
  const sectionStats = calculateStats(sectionChunks);
  
  // Show stats for section chunks when available, or for active tab
  const showStats = sectionChunks.length > 0 || activeChunks.length > 0;
  const showSectionStats = sectionChunks.length > 0;

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 px-4 py-3 bg-gray-50">
        <h2 className="text-lg font-semibold text-gray-800">Page Chunks</h2>
        {chunksData.pageContent && (
          <p className="text-sm text-gray-600 mt-1">
            {chunksData.pageContent.title} ({chunks.length} chunks)
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 bg-gray-50 flex overflow-x-auto">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
            activeTab === 'all'
              ? 'border-blue-500 text-blue-600 bg-white'
              : 'border-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-100'
          }`}
        >
          All ({chunks.length})
        </button>
        {availableTypes.map(type => {
          const count = chunksByType.get(type)?.length || 0;
          return (
            <button
              key={type}
              onClick={() => setActiveTab(type)}
              className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === type
                  ? 'border-blue-500 text-blue-600 bg-white'
                  : 'border-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-100'
              }`}
            >
              {COMPONENT_TYPE_LABELS[type]} ({count})
            </button>
          );
        })}
      </div>

      {/* Filter and Sort Controls */}
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Sort Control */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Sort by:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="default">Default Order</option>
              <option value="size-desc">Size (Largest First)</option>
              <option value="size-asc">Size (Smallest First)</option>
            </select>
          </div>

          {/* Size Filter Toggle */}
          <button
            onClick={() => setShowSizeFilter(!showSizeFilter)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              showSizeFilter || sizeFilter.min !== undefined || sizeFilter.max !== undefined
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            🔍 Filter by Size
          </button>

          {/* Active Filter Indicator */}
          {(sizeFilter.min !== undefined || sizeFilter.max !== undefined) && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>Filtered:</span>
              <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded">
                {sizeFilter.min !== undefined ? `Min: ${sizeFilter.min}` : ''}
                {sizeFilter.min !== undefined && sizeFilter.max !== undefined ? ' • ' : ''}
                {sizeFilter.max !== undefined ? `Max: ${sizeFilter.max}` : ''}
              </span>
              <button
                onClick={() => {
                  setSizeFilter({});
                  setShowSizeFilter(false);
                }}
                className="text-red-600 hover:text-red-800 text-xs"
              >
                Clear
              </button>
            </div>
          )}

          {/* Results Count */}
          <div className="ml-auto text-sm text-gray-600">
            Showing {activeChunks.length} of {activeTab === 'all' ? chunks.length : chunksByType.get(activeTab)?.length || 0} chunks
          </div>
        </div>

        {/* Size Filter Inputs */}
        {showSizeFilter && (
          <div className="mt-3 pt-3 border-t border-gray-200 flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Min words:</label>
              <input
                type="number"
                min="0"
                value={sizeFilter.min ?? ''}
                onChange={(e) => {
                  const value = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                  setSizeFilter({ ...sizeFilter, min: value });
                }}
                placeholder="0"
                className="w-24 px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Max words:</label>
              <input
                type="number"
                min="0"
                value={sizeFilter.max ?? ''}
                onChange={(e) => {
                  const value = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                  setSizeFilter({ ...sizeFilter, max: value });
                }}
                placeholder="∞"
                className="w-24 px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Statistics Panel */}
      {showStats && (
        <div className="border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-4">
          {showSectionStats && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-800">Section Chunks Statistics</h3>
                <span className="text-xs text-gray-600">
                  Based on {sectionStats.totalChunks} section chunk{sectionStats.totalChunks !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                  <div className="text-xs text-gray-600 mb-1">Total Words</div>
                  <div className="text-lg font-bold text-blue-600">{sectionStats.totalWords.toLocaleString()}</div>
                </div>
                <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                  <div className="text-xs text-gray-600 mb-1">Average Size</div>
                  <div className="text-lg font-bold text-green-600">{sectionStats.averageSize.toLocaleString()}</div>
                </div>
                <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                  <div className="text-xs text-gray-600 mb-1">Median Size</div>
                  <div className="text-lg font-bold text-purple-600">{sectionStats.medianSize.toLocaleString()}</div>
                </div>
                <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                  <div className="text-xs text-gray-600 mb-1">Min Size</div>
                  <div className="text-lg font-bold text-orange-600">{sectionStats.minSize.toLocaleString()}</div>
                </div>
                <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                  <div className="text-xs text-gray-600 mb-1">Max Size</div>
                  <div className="text-lg font-bold text-red-600">{sectionStats.maxSize.toLocaleString()}</div>
                </div>
              </div>
            </div>
          )}
          
          {/* Current Tab Statistics (if not showing section stats or if different from section) */}
          {activeChunks.length > 0 && (activeTab !== 'section' || !showSectionStats) && (
            <div>
              {showSectionStats && <div className="border-t border-gray-300 pt-4 mt-4"></div>}
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-800">
                  {activeTab === 'all' ? 'All Chunks Statistics' : `${COMPONENT_TYPE_LABELS[activeTab]} Statistics`}
                </h3>
                <span className="text-xs text-gray-600">
                  Based on {stats.totalChunks} chunk{stats.totalChunks !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                  <div className="text-xs text-gray-600 mb-1">Total Words</div>
                  <div className="text-lg font-bold text-blue-600">{stats.totalWords.toLocaleString()}</div>
                </div>
                <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                  <div className="text-xs text-gray-600 mb-1">Average Size</div>
                  <div className="text-lg font-bold text-green-600">{stats.averageSize.toLocaleString()}</div>
                </div>
                <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                  <div className="text-xs text-gray-600 mb-1">Median Size</div>
                  <div className="text-lg font-bold text-purple-600">{stats.medianSize.toLocaleString()}</div>
                </div>
                <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                  <div className="text-xs text-gray-600 mb-1">Min Size</div>
                  <div className="text-lg font-bold text-orange-600">{stats.minSize.toLocaleString()}</div>
                </div>
                <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                  <div className="text-xs text-gray-600 mb-1">Max Size</div>
                  <div className="text-lg font-bold text-red-600">{stats.maxSize.toLocaleString()}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Chunks List */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeChunks.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            No chunks found for this category
          </div>
        ) : (
          <div className="space-y-4">
            {activeChunks.map((chunk, index) => (
              <ChunkCard key={chunk.id || index} chunk={chunk} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

interface ChunkCardProps {
  chunk: ContentChunk;
}

const ChunkCard: React.FC<ChunkCardProps> = ({ chunk }) => {
  const [expanded, setExpanded] = useState(false);
  const componentType = chunk.componentType || 'text';
  const componentData = chunk.componentData;

  return (
    <div className="border border-gray-200 rounded-lg bg-white shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div
        className="px-4 py-3 cursor-pointer flex items-center justify-between"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-1 text-xs font-medium rounded bg-blue-100 text-blue-800">
              {COMPONENT_TYPE_LABELS[componentType]}
            </span>
            {chunk.metadata.heading && (
              <span className="text-sm font-medium text-gray-800">
                {chunk.metadata.heading}
              </span>
            )}
            <span className="px-2 py-1 text-xs font-semibold rounded bg-green-100 text-green-800">
              {chunk.metadata.wordCount || 0} words
            </span>
          </div>
          {componentData && (
            <div className="mt-1 text-xs text-gray-500">
              Selector: <code className="bg-gray-100 px-1 rounded">{componentData.selector}</code>
            </div>
          )}
        </div>
        <button className="text-gray-400 hover:text-gray-600">
          {expanded ? '▼' : '▶'}
        </button>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100">
          {/* Component Metadata */}
          {componentData && (
            <div className="mt-3 mb-3 p-3 bg-gray-50 rounded text-sm">
              <div className="font-medium text-gray-700 mb-2">Component Details:</div>
              <div className="space-y-1 text-xs text-gray-600">
                <div><strong>Type:</strong> {componentData.type}</div>
                <div><strong>Selector:</strong> <code className="bg-white px-1 rounded">{componentData.selector}</code></div>
                {componentData.metadata.isInteractive && (
                  <div><strong>Interactive:</strong> Yes</div>
                )}
                {componentData.metadata.inputType && (
                  <div><strong>Input Type:</strong> {componentData.metadata.inputType}</div>
                )}
                {componentData.metadata.label && (
                  <div><strong>Label:</strong> {componentData.metadata.label}</div>
                )}
                {componentData.metadata.required && (
                  <div><strong>Required:</strong> Yes</div>
                )}
              </div>
            </div>
          )}

          {/* Nested Chunks */}
          {chunk.nestedChunks && chunk.nestedChunks.length > 0 && (
            <div className="mt-3 mb-3">
              <div className="font-medium text-gray-700 mb-2 text-sm">
                Nested Components ({chunk.nestedChunks.length}):
              </div>
              <div className="space-y-2">
                {chunk.nestedChunks.map((nested: ContentChunk, idx: number) => (
                  <div key={nested.id || idx} className="pl-3 border-l-2 border-blue-200 bg-blue-50 p-2 rounded text-xs">
                    <div className="font-medium text-gray-700">
                      {COMPONENT_TYPE_LABELS[nested.componentType || 'text']}
                    </div>
                    {nested.componentData && (
                      <div className="text-gray-600 mt-1">
                        <code className="bg-white px-1 rounded">{nested.componentData.selector}</code>
                        {nested.componentData.metadata.label && (
                          <span className="ml-2">({nested.componentData.metadata.label})</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Chunk Content */}
          <div className="mt-3">
            <div className="font-medium text-gray-700 mb-2 text-sm">Content:</div>
            <pre className="text-xs text-gray-600 bg-gray-50 p-3 rounded overflow-x-auto whitespace-pre-wrap font-mono">
              {chunk.content}
            </pre>
          </div>

          {/* Metadata */}
          <div className="mt-3 text-xs text-gray-500">
            <div>Word Count: {chunk.metadata.wordCount}</div>
            {chunk.metadata.domPath && (
              <div>DOM Path: <code className="bg-gray-100 px-1 rounded">{chunk.metadata.domPath}</code></div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};


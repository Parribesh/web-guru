// Session Data Storage - Persists chunks and embeddings to disk
// Allows caching and reuse of chunks for the same URLs

import * as fs from 'fs';
import * as path from 'path';
import { ContentChunk, PageContent, DOMComponent } from '../../../shared/types';
import { eventLogger } from '../../logging/event-logger';

const DATA_DIR = path.join(process.cwd(), 'data', 'sessions');

interface SessionDataRaw {
  sessionId: string;
  url: string;
  title: string;
  pageContent: PageContent;
  chunks: ContentChunk[];
  components: DOMComponent[];
  chunkEmbeddings: Record<string, number[]>; // Stored as Record for JSON
  cachedAt: number;
}

interface SessionData {
  sessionId: string;
  url: string;
  title: string;
  pageContent: PageContent;
  chunks: ContentChunk[];
  components: DOMComponent[];
  chunkEmbeddings: Map<string, number[]>; // Converted to Map after loading
  cachedAt: number;
}

// URL to sessionId mapping for quick lookup
const urlToSessionMap = new Map<string, string>();

// Ensure data directory exists
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    eventLogger.info('Session Storage', `Created data directory: ${DATA_DIR}`);
  }
}

// Get session directory path
function getSessionDir(sessionId: string): string {
  return path.join(DATA_DIR, sessionId);
}

// Convert Map to plain object for JSON serialization
function mapToObject<T>(map: Map<string, T>): Record<string, T> {
  const obj: Record<string, T> = {};
  for (const [key, value] of map.entries()) {
    obj[key] = value;
  }
  return obj;
}

// Convert plain object back to Map
function objectToMap<T>(obj: Record<string, T>): Map<string, T> {
  const map = new Map<string, T>();
  for (const [key, value] of Object.entries(obj)) {
    map.set(key, value);
  }
  return map;
}

// Save session data to disk
export function saveSessionData(
  sessionId: string,
  url: string,
  title: string,
  pageContent: PageContent,
  chunks: ContentChunk[],
  components: DOMComponent[],
  chunkEmbeddings: Map<string, number[]>
): void {
  try {
    ensureDataDir();
    const sessionDir = getSessionDir(sessionId);
    
    // Create session directory
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    
    // Prepare data for serialization
    const sessionData: SessionDataRaw = {
      sessionId,
      url,
      title,
      pageContent,
      chunks,
      components,
      chunkEmbeddings: mapToObject(chunkEmbeddings),
      cachedAt: Date.now(),
    };
    
    // Save to JSON file
    const dataFile = path.join(sessionDir, 'data.json');
    fs.writeFileSync(dataFile, JSON.stringify(sessionData, null, 2), 'utf8');
    
    // Update URL mapping
    urlToSessionMap.set(url, sessionId);
    
    eventLogger.success('Session Storage', `Saved session data to: ${dataFile}`);
    eventLogger.info('Session Storage', `Saved ${chunks.length} chunks and ${components.length} components`);
  } catch (error: any) {
    eventLogger.error('Session Storage', `Failed to save session data: ${error.message}`);
    throw error;
  }
}

// Load session data from disk
export function loadSessionData(sessionId: string): SessionData | null {
  try {
    const sessionDir = getSessionDir(sessionId);
    const dataFile = path.join(sessionDir, 'data.json');
    
    if (!fs.existsSync(dataFile)) {
      return null;
    }
    
    const fileContent = fs.readFileSync(dataFile, 'utf8');
    const rawData: SessionDataRaw = JSON.parse(fileContent);
    
    // Convert embeddings object back to Map
    const chunkEmbeddings = objectToMap(rawData.chunkEmbeddings);
    
    // Create properly typed SessionData
    const sessionData: SessionData = {
      ...rawData,
      chunkEmbeddings,
    };
    
    // Update URL mapping
    urlToSessionMap.set(sessionData.url, sessionId);
    
    eventLogger.success('Session Storage', `Loaded session data from: ${dataFile}`);
    return sessionData;
  } catch (error: any) {
    eventLogger.error('Session Storage', `Failed to load session data: ${error.message}`);
    return null;
  }
}

// Find session by URL (check all existing sessions)
export function findSessionByUrl(url: string): SessionData | null {
  // First check the in-memory map
  const cachedSessionId = urlToSessionMap.get(url);
  if (cachedSessionId) {
    const loaded = loadSessionData(cachedSessionId);
    if (loaded && loaded.url === url) {
      return loaded;
    }
  }
  
  // Scan all session directories
  try {
    ensureDataDir();
    
    if (!fs.existsSync(DATA_DIR)) {
      return null;
    }
    
    const sessionDirs = fs.readdirSync(DATA_DIR, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    for (const sessionId of sessionDirs) {
      const sessionData = loadSessionData(sessionId);
      if (sessionData && sessionData.url === url) {
        // Update mapping for faster future lookups
        urlToSessionMap.set(url, sessionId);
        eventLogger.info('Session Storage', `Found existing session for URL: ${url} (session: ${sessionId})`);
        return sessionData;
      }
    }
    
    return null;
  } catch (error: any) {
    eventLogger.error('Session Storage', `Failed to find session by URL: ${error.message}`);
    return null;
  }
}

// Get all session IDs
export function getAllSessionIds(): string[] {
  try {
    ensureDataDir();
    
    if (!fs.existsSync(DATA_DIR)) {
      return [];
    }
    
    return fs.readdirSync(DATA_DIR, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
  } catch (error: any) {
    eventLogger.error('Session Storage', `Failed to get session IDs: ${error.message}`);
    return [];
  }
}

// Delete session data
export function deleteSessionData(sessionId: string): void {
  try {
    const sessionDir = getSessionDir(sessionId);
    
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      
      // Remove from URL mapping
      for (const [url, sid] of urlToSessionMap.entries()) {
        if (sid === sessionId) {
          urlToSessionMap.delete(url);
          break;
        }
      }
      
      eventLogger.success('Session Storage', `Deleted session data: ${sessionId}`);
    }
  } catch (error: any) {
    eventLogger.error('Session Storage', `Failed to delete session data: ${error.message}`);
  }
}

// Initialize URL mapping on startup
export function initializeUrlMapping(): void {
  try {
    const sessionIds = getAllSessionIds();
    let loadedCount = 0;
    
    for (const sessionId of sessionIds) {
      const sessionData = loadSessionData(sessionId);
      if (sessionData) {
        urlToSessionMap.set(sessionData.url, sessionId);
        loadedCount++;
      }
    }
    
    eventLogger.info('Session Storage', `Initialized URL mapping: ${loadedCount} sessions loaded`);
  } catch (error: any) {
    eventLogger.error('Session Storage', `Failed to initialize URL mapping: ${error.message}`);
  }
}


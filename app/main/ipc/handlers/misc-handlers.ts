// Miscellaneous IPC Handlers (QA, Logging, Window, DevTools)

import { ipcMain, BrowserWindow } from 'electron';
import { IPCChannels, QARequest } from '../../../shared/types';
import { eventLogger } from '../../logging/event-logger';
import { answerQuestion } from '../../agent/qa/service';
import { getEmbeddingService } from '../../agent/rag/embedding-service';

export function setupMiscHandlers(mainWindow: BrowserWindow): void {
  // QA request handler
  ipcMain.handle(IPCChannels.qa.ask, async (event, request: QARequest) => {
    console.log(`QA request for tab ${request.tabId}: ${request.question}`);
    return await answerQuestion(request);
  });

  // Logging handlers
  ipcMain.handle(IPCChannels.log.getEvents, () => {
    return eventLogger.getEvents();
  });

  ipcMain.handle(IPCChannels.log.clear, () => {
    eventLogger.clear();
    return { success: true };
  });

  // Window management
  ipcMain.handle(IPCChannels.window.minimize, async () => {
    mainWindow.minimize();
  });

  ipcMain.handle(IPCChannels.window.maximize, async () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle(IPCChannels.window.close, async () => {
    mainWindow.close();
  });

  // Dev tools
  ipcMain.handle(IPCChannels.devTools.open, async (event, tabId?: string) => {
    if (tabId) {
      // TODO: Implement per-tab dev tools
      console.log(`Opening dev tools for tab: ${tabId}`);
    } else {
      mainWindow.webContents.openDevTools();
    }
  });

  // Embedding service status (for debugging)
  ipcMain.handle('embedding-service:status', async () => {
    try {
      const service = getEmbeddingService();
      const isAvailable = await service.healthCheck();
      const socketConnected = (service as any).socket && (service as any).socket.readyState === 1;
      
      // Get pending task details
      const pendingTaskDetails: Array<{ taskId: string; chunkId: string; batchId?: string; waitTime: number }> = [];
      if (service.pendingTasks) {
        const now = Date.now();
        service.pendingTasks.forEach((task, taskId) => {
          const waitTime = now - task.waitStartTime;
          pendingTaskDetails.push({ 
            taskId, 
            chunkId: task.chunkId, 
            batchId: task.batchId,
            waitTime,
          });
        });
      }
      
      return {
        success: true,
        data: {
          available: isAvailable,
          baseUrl: service.baseUrl || 'http://localhost:8000',
          pendingTasks: service.pendingTasks ? service.pendingTasks.size : 0,
          pendingTaskDetails,
          socketConnected: socketConnected,
        },
      };
    } catch (error: any) {
      console.error('[IPC] Embedding service status error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // Task monitoring data
  ipcMain.handle('embedding:tasks-monitor', async () => {
    try {
      const service = getEmbeddingService();
      
      // Get pending tasks with wait times
      const pendingTasks: Array<{
        taskId: string;
        chunkId: string;
        batchId?: string;
        submittedAt: number;
        waitStartTime: number;
        waitDuration: number;  // Current wait time
        status: 'pending';
      }> = [];
      
      if (service.pendingTasks) {
        const now = Date.now();
        service.pendingTasks.forEach((task, taskId) => {
          const metric = service.taskMetrics.get(taskId);
          pendingTasks.push({
            taskId,
            chunkId: task.chunkId,
            batchId: task.batchId,
            submittedAt: task.startTime,
            waitStartTime: task.waitStartTime,
            waitDuration: now - task.waitStartTime,
            status: 'pending',
          });
        });
      }
      
      // Get completed/failed tasks from metrics
      const completedTasks: Array<{
        taskId: string;
        chunkId: string;
        batchId?: string;
        submittedAt: number;
        waitStartTime: number;
        completedAt: number;
        waitDuration: number;
        status: 'completed' | 'failed' | 'timeout';
        error?: string;
      }> = [];
      
      if (service.taskMetrics) {
        service.taskMetrics.forEach((metric) => {
          if (metric.status !== 'pending' && metric.completedAt !== undefined && metric.waitDuration !== undefined) {
            completedTasks.push({
              taskId: metric.taskId,
              chunkId: metric.chunkId,
              batchId: metric.batchId,
              submittedAt: metric.submittedAt,
              waitStartTime: metric.waitStartTime,
              completedAt: metric.completedAt,
              waitDuration: metric.waitDuration,
              status: metric.status as 'completed' | 'failed' | 'timeout',
              error: metric.error,
            });
          }
        });
      }
      
      // Sort by completion time (most recent first)
      completedTasks.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
      
      // Group by batch
      type TaskForBatch = {
        taskId: string;
        chunkId: string;
        batchId?: string;
        submittedAt: number;
        waitStartTime: number;
        completedAt?: number;
        waitDuration: number;
        status: 'pending' | 'completed' | 'failed' | 'timeout';
        error?: string;
      };
      
      const tasksByBatch = new Map<string, TaskForBatch[]>();
      [...pendingTasks.map(t => ({ ...t, completedAt: undefined })), ...completedTasks].forEach(task => {
        const batchId = task.batchId || 'unknown';
        if (!tasksByBatch.has(batchId)) {
          tasksByBatch.set(batchId, []);
        }
        tasksByBatch.get(batchId)!.push(task);
      });
      
      // Calculate batch statistics
      const batchStats = Array.from(tasksByBatch.entries()).map(([batchId, tasks]) => {
        const completed = tasks.filter(t => t.status === 'completed');
        const failed = tasks.filter(t => t.status === 'failed' || t.status === 'timeout');
        const pending = tasks.filter(t => t.status === 'pending');
        const avgWaitTime = completed.length > 0
          ? completed.reduce((sum, t) => sum + t.waitDuration, 0) / completed.length
          : 0;
        const maxWaitTime = completed.length > 0
          ? Math.max(...completed.map(t => t.waitDuration))
          : 0;
        const minWaitTime = completed.length > 0
          ? Math.min(...completed.map(t => t.waitDuration))
          : 0;
        
        return {
          batchId,
          totalTasks: tasks.length,
          completed: completed.length,
          failed: failed.length,
          pending: pending.length,
          avgWaitTime,
          maxWaitTime,
          minWaitTime,
          successRate: tasks.length > 0 ? (completed.length / tasks.length) * 100 : 0,
        };
      });
      
      return {
        success: true,
        data: {
          pendingTasks,
          completedTasks: completedTasks.slice(0, 1000), // Limit to last 1000 completed tasks
          batchStats,
          totalPending: pendingTasks.length,
          totalCompleted: completedTasks.length,
        },
      };
    } catch (error: any) {
      console.error('[IPC] Task monitor error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // Set up embedding service event forwarding
  const service = getEmbeddingService();
  
  console.log('[IPC] Setting up embedding service event forwarding to renderer');
  
  // Forward all embedding service events to renderer
  service.on('task_complete', (taskId: string, data?: { chunkId?: string; batchId?: string }) => {
    const eventData = {
      type: 'task_complete',
      taskId,
      chunkId: data?.chunkId,
      batchId: data?.batchId,
      timestamp: Date.now(),
    };
    console.log('[IPC] Forwarding task_complete event:', eventData);
    mainWindow.webContents.send('embedding-service:event', eventData);
  });

  service.on('task_error', (taskId: string, error: Error, chunkId?: string, batchId?: string) => {
    mainWindow.webContents.send('embedding-service:event', {
      type: 'task_error',
      taskId,
      chunkId,
      batchId,
      error: error.message,
      timestamp: Date.now(),
    });
  });

  service.on('task_progress', (taskId: string, progress: number, chunkId?: string, batchId?: string) => {
    mainWindow.webContents.send('embedding-service:event', {
      type: 'task_progress',
      taskId,
      chunkId,
      batchId,
      progress,
      timestamp: Date.now(),
    });
  });

  service.on('connected', () => {
    mainWindow.webContents.send('embedding-service:event', {
      type: 'connected',
      timestamp: Date.now(),
    });
  });

  service.on('disconnected', () => {
    mainWindow.webContents.send('embedding-service:event', {
      type: 'disconnected',
      timestamp: Date.now(),
    });
  });

  service.on('error', (error: Error) => {
    mainWindow.webContents.send('embedding-service:event', {
      type: 'error',
      error: error.message,
      timestamp: Date.now(),
    });
  });

  service.on('task_submitted', (taskId: string, chunkId: string, batchId?: string) => {
    mainWindow.webContents.send('embedding-service:event', {
      type: 'task_submitted',
      taskId,
      chunkId,
      batchId,
      timestamp: Date.now(),
    });
  });

  service.on('job_complete', (jobId: string, stats: any) => {
    mainWindow.webContents.send('embedding-service:event', {
      type: 'job_complete',
      jobId,
      stats,
      timestamp: Date.now(),
    });
  });

  // Forward WebSocket messages that contain job_id
  service.on('websocket_message', (data: { jobId: string; originalMessage: any }) => {
    const eventData = {
      type: 'websocket_message',
      jobId: data.jobId,
      originalMessage: data.originalMessage,
      timestamp: Date.now(),
    };
    console.log('[IPC] Forwarding websocket_message event:', eventData);
    mainWindow.webContents.send('embedding-service:event', eventData);
  });

  // Forward job_status_update events from WebSocket
  service.on('job_status_update', (jobId: string, jobStatus: any) => {
    const eventData = {
      type: 'job_status_update',
      jobId,
      jobStatus,
      timestamp: Date.now(),
    };
    console.log('[IPC] Forwarding job_status_update event for job:', jobId);
    mainWindow.webContents.send('embedding-service:event', eventData);
  });

  // Single WebSocket connection to backend for all job status updates
  let globalWebSocket: any = null;
  let WebSocketClass: any = null;
  let isConnecting = false;

  // Try to load WebSocket library
  try {
    WebSocketClass = require('ws');
  } catch (err) {
    console.warn('[IPC] WebSocket library not available for job monitoring');
  }

  // Function to connect to the global WebSocket endpoint
  const connectToGlobalWebSocket = () => {
    if (!WebSocketClass) {
      console.warn('[IPC] Cannot connect to WebSocket: library not available');
      return;
    }

    // If already connected or connecting, don't reconnect
    if (globalWebSocket || isConnecting) {
      if (globalWebSocket?.readyState === 1) {
        console.log('[IPC] Already connected to global WebSocket');
        return;
      }
      if (isConnecting) {
        console.log('[IPC] WebSocket connection already in progress');
        return;
      }
    }

    const service = getEmbeddingService();
    const baseUrl = service.baseUrl || 'http://127.0.0.1:8000';
    const wsUrl = baseUrl.replace(/^http/, 'ws') + `/ws`;
    
    console.log(`[IPC] Connecting to global WebSocket: ${wsUrl}`);
    isConnecting = true;

    try {
      globalWebSocket = new WebSocketClass(wsUrl);

      globalWebSocket.on('open', () => {
        console.log('[IPC] Connected to global WebSocket');
        isConnecting = false;
        mainWindow.webContents.send('embedding-service:event', {
          type: 'websocket_connected',
          timestamp: Date.now(),
        });
      });

      globalWebSocket.on('message', (data: Buffer | string) => {
        try {
          const message = typeof data === 'string' ? data : data.toString();
          const parsed = JSON.parse(message);
          
          // Backend sends: { type: "job_status_update", payload: { job_id: "...", status: {...} } }
          // Forward the entire message to renderer (components will filter by job_id if needed)
          console.log(`[IPC] Received WebSocket message:`, JSON.stringify(parsed).substring(0, 200));
          
          // Forward ALL events to renderer (no filtering - renderer will filter)
          const eventData = {
            type: parsed.type || 'websocket_message',
            payload: parsed.payload || parsed,
            timestamp: Date.now(),
          };
          
          // Forward to renderer for UI monitoring
          mainWindow.webContents.send('embedding-service:event', eventData);
        } catch (error: any) {
          console.error(`[IPC] Error parsing WebSocket message: ${error.message}`);
        }
      });

      globalWebSocket.on('error', (error: Error) => {
        console.error(`[IPC] WebSocket error:`, error.message);
        isConnecting = false;
        mainWindow.webContents.send('embedding-service:event', {
          type: 'websocket_error',
          error: error.message,
          timestamp: Date.now(),
        });
      });

      globalWebSocket.on('close', () => {
        console.log('[IPC] WebSocket closed');
        isConnecting = false;
        globalWebSocket = null;
        mainWindow.webContents.send('embedding-service:event', {
          type: 'websocket_closed',
          timestamp: Date.now(),
        });
        
        // Attempt to reconnect after a delay
        setTimeout(() => {
          if (!globalWebSocket) {
            console.log('[IPC] Attempting to reconnect WebSocket...');
            connectToGlobalWebSocket();
          }
        }, 5000);
      });
    } catch (error: any) {
      console.error(`[IPC] Error creating WebSocket connection: ${error.message}`);
      isConnecting = false;
      globalWebSocket = null;
    }
  };

  // Listen for job_started events to forward to renderer (and ensure WebSocket is connected)
  service.on('job_started', (jobId: string) => {
    console.log(`[IPC] Job started event received for job ${jobId}`);
    
    // Forward to renderer
    mainWindow.webContents.send('embedding-service:event', {
      type: 'job_started',
      jobId,
      timestamp: Date.now(),
    });
    
    // Ensure WebSocket is connected (if not already)
    if (!globalWebSocket || globalWebSocket.readyState !== 1) {
      connectToGlobalWebSocket();
    }
  });

  // Also listen for websocket_message events that contain jobId (backup detection)
  service.on('websocket_message', (data: { jobId: string; originalMessage: any }) => {
    // Forward to renderer if needed
    if (data.jobId) {
      mainWindow.webContents.send('embedding-service:event', {
        type: 'websocket_message',
        jobId: data.jobId,
        originalMessage: data.originalMessage,
        timestamp: Date.now(),
      });
    }
    
    // Ensure WebSocket is connected
    if (!globalWebSocket || globalWebSocket.readyState !== 1) {
      connectToGlobalWebSocket();
    }
  });

  // IPC handler to manually connect/disconnect WebSocket (for renderer components)
  ipcMain.handle('embedding:connect-websocket', async () => {
    connectToGlobalWebSocket();
    return { success: true };
  });

  ipcMain.handle('embedding:disconnect-websocket', async () => {
    if (globalWebSocket) {
      console.log('[IPC] Disconnecting WebSocket');
      globalWebSocket.close();
      globalWebSocket = null;
    }
    return { success: true };
  });

  // Auto-connect WebSocket when handler is registered
  connectToGlobalWebSocket();
  
  console.log('[IPC] Embedding service event forwarding set up successfully');

  // Embedding stats handler
  ipcMain.handle('embedding:stats', async () => {
    try {
      const { getEmbeddingBatchSize, getConfig } = require('../../config');
      const service = getEmbeddingService();
      const config = getConfig();
      
      return {
        success: true,
        data: {
          config: {
            batchSize: getEmbeddingBatchSize(),
            timeout: config.embedding.timeout,
            baseUrl: service.baseUrl || 'http://127.0.0.1:8000',
            socketUrl: (service as any).socketUrl,
          },
          recentExecutions: [], // Will be populated from event log
        },
      };
    } catch (error: any) {
      console.error('[IPC] Embedding stats error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // Job stats handler
  ipcMain.handle('embedding:job-stats', async (event, jobId: string) => {
    try {
      const service = getEmbeddingService();
      const jobStats = await service.getJobStats(jobId);
      return {
        success: true,
        data: jobStats,
      };
    } catch (error: any) {
      console.error('[IPC] Job stats error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // WebSocket status handler
  ipcMain.handle('websocket:status', async () => {
    try {
      const service = getEmbeddingService();
      const baseUrl = service.baseUrl || 'http://127.0.0.1:8000';
      const fullUrl = `${baseUrl}/api/websockets/status`;
      
      return new Promise((resolve) => {
        const urlObj = new URL(fullUrl);
        const http = require('http');
        const https = require('https');
        const client = urlObj.protocol === 'https:' ? https : http;
        
        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          path: urlObj.pathname + (urlObj.search || ''),
          method: 'GET',
          headers: {},
          timeout: 5000,
        };

        const req = client.request(options, (res: any) => {
          let data = '';

          res.on('data', (chunk: any) => {
            data += chunk;
          });

          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const wsStatus = JSON.parse(data);
                resolve({
                  success: true,
                  data: wsStatus,
                });
              } catch (error: any) {
                console.error('[IPC] Failed to parse WebSocket status response:', error);
                resolve({
                  success: false,
                  error: `Failed to parse response: ${error.message}`,
                });
              }
            } else {
              resolve({
                success: false,
                error: `HTTP ${res.statusCode}: ${data}`,
              });
            }
          });
        });

        req.on('error', (error: any) => {
          console.error('[IPC] WebSocket status request error:', error);
          resolve({
            success: false,
            error: error.message,
          });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({
            success: false,
            error: 'Request timeout',
          });
        });

        req.end();
      });
    } catch (error: any) {
      console.error('[IPC] WebSocket status error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // Queue status handler (for debugging)
  ipcMain.handle('queue:status', async () => {
    try {
      const service = getEmbeddingService();
      const baseUrl = service.baseUrl || 'http://127.0.0.1:8000';
      const queueUrl = `${baseUrl}/api/queue/status`;
      
      return new Promise((resolve) => {
        const urlObj = new URL(queueUrl);
        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          path: urlObj.pathname + (urlObj.search || ''),
          method: 'GET',
          timeout: 5000,
        };

        const client = urlObj.protocol === 'https:' ? require('https') : require('http');
        const req = client.request(options, (res: any) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const queueStatus = JSON.parse(data);
                resolve({
                  success: true,
                  data: queueStatus,
                });
              } catch (error: any) {
                resolve({
                  success: false,
                  error: `Failed to parse response: ${error.message}`,
                });
              }
            } else {
              resolve({
                success: false,
                error: `HTTP ${res.statusCode}: ${data}`,
              });
            }
          });
        });

        req.on('error', (error: Error) => {
          resolve({
            success: false,
            error: error.message,
          });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({
            success: false,
            error: 'Request timeout',
          });
        });

        req.end();
      });
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  });
}


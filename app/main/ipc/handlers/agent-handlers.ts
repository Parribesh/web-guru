// Agent Operations IPC Handlers

import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { SessionManager } from '../../session/SessionManager';
import { IPCChannels } from '../../../shared/types';

export function setupAgentHandlers(sessionManager: SessionManager): void {
  console.log('[AgentHandlers] Setting up agent IPC handlers...');
  console.log('[AgentHandlers] Channel getTestBookingUrl:', IPCChannels.utils.getTestBookingUrl);
  
  // Send message to agent
  ipcMain.handle(IPCChannels.agent.sendMessage, async (event, sessionId: string, content: string) => {
    const agentManager = sessionManager.getAgentManager(sessionId);
    if (!agentManager) {
      return { success: false, error: `Session ${sessionId} not found` };
    }

    try {
      await agentManager.askQuestion(content);
      return { success: true };
    } catch (error: any) {
      console.error('Error processing message:', error);
      return { success: false, error: error.message };
    }
  });

  // Helper to get test booking URL
  ipcMain.handle(IPCChannels.utils.getTestBookingUrl, async () => {
    console.log('[AgentHandlers] getTestBookingUrl handler called');
    let testBookingPath: string;

    if (__dirname.includes('dist')) {
      const projectRoot = path.resolve(__dirname, '../../../../');
      testBookingPath = path.join(projectRoot, 'app', 'test-booking.html');
    } else {
      testBookingPath = path.join(__dirname, '../../../test-booking.html');
    }

    const normalizedPath = path.resolve(testBookingPath);

    if (!fs.existsSync(normalizedPath)) {
      const fallbackPath = path.join(process.cwd(), 'app', 'test-booking.html');
      if (fs.existsSync(fallbackPath)) {
        return `file://${path.resolve(fallbackPath)}`;
      }
      throw new Error(`Test booking file not found at ${normalizedPath}`);
    }

    return `file://${normalizedPath}`;
  });
}

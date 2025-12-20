// CLI Server for Command-Line Interface

import * as net from 'net';
import { BrowserWindow } from 'electron';
import { getSessionManager } from '../ipc';

const CLI_PORT = 9876;

interface CLICommand {
  type: string;
  [key: string]: any;
}

interface CLIResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export function setupCLIServer(
  mainWindow: BrowserWindow | null,
  handleCreateSession: (event: any, request: { url?: string; initialMessage?: string }) => Promise<any>
): void {
  const server = net.createServer((socket) => {
    let buffer = '';

    socket.on('data', async (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const command: CLICommand = JSON.parse(line);
          let response: CLIResponse;

          try {
            if (command.type === 'create-session') {
              const urlArg = command.url;
              const session = await handleCreateSession(null, { url: urlArg });
              response = {
                success: true,
                data: `Session created: ${session.id}\nTitle: ${session.title}\nURL: ${session.url || 'none'}`,
              };
            } else if (command.type === 'list-sessions') {
              const sessionManager = getSessionManager();
              if (!sessionManager) {
                response = { success: false, error: 'SessionManager not available' };
              } else {
                const sessions = sessionManager.getAllSessions();
                response = {
                  success: true,
                  data: sessions.map((s) => ({
                    id: s.id,
                    title: s.title,
                    url: s.url,
                    state: s.state,
                    messages: s.messages.length,
                  })),
                };
              }
            } else if (command.type === 'ask-question') {
              const sessionManager = getSessionManager();
              if (!sessionManager) {
                response = { success: false, error: 'SessionManager not available' };
              } else {
                const session = sessionManager.getSession(command.sessionId);
                if (!session) {
                  response = { success: false, error: `Session not found: ${command.sessionId}` };
                } else {
                  const agentManager = sessionManager.getAgentManager(command.sessionId);
                  if (!agentManager) {
                    response = { success: false, error: `AgentManager not found for session: ${command.sessionId}` };
                  } else {
                    const qaResponse = await agentManager.askQuestion(command.question);
                    if (qaResponse.success) {
                      response = {
                        success: true,
                        data: `Answer: ${qaResponse.answer}\nUsed ${qaResponse.relevantChunks?.length || 0} relevant chunk(s)`,
                      };
                    } else {
                      response = { success: false, error: qaResponse.error || 'Failed to get answer' };
                    }
                  }
                }
              }
            } else {
              response = { success: false, error: `Unknown command type: ${command.type}` };
            }
          } catch (error: any) {
            response = { success: false, error: error.message || 'Unknown error' };
          }

          socket.write(JSON.stringify(response) + '\n');
        } catch (parseError) {
          socket.write(JSON.stringify({ success: false, error: 'Invalid JSON' }) + '\n');
        }
      }
    });

    socket.on('end', () => {
      // Client disconnected
    });

    socket.on('error', (err) => {
      console.error('CLI socket error:', err);
    });
  });

  server.listen(CLI_PORT, '127.0.0.1', () => {
    console.log(`✅ CLI server listening on port ${CLI_PORT}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ CLI port ${CLI_PORT} already in use`);
    } else {
      console.error('CLI server error:', err);
    }
  });
}

#!/usr/bin/env node

/**
 * CLI tool for interacting with the Electron AI Browser
 * This tool communicates with the running Electron app via IPC
 */

import * as net from 'net';
import * as readline from 'readline';
import * as path from 'path';

const CLI_PORT = 9876;
const CLI_HOST = '127.0.0.1';

interface CLICommand {
  type: string;
  [key: string]: any;
}

interface CLIResponse {
  success: boolean;
  data?: any;
  error?: string;
}

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function colorize(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`;
}

function printHelp() {
  console.log(colorize('\n🤖 AI Browser CLI', 'bright'));
  console.log('==================\n');
  console.log('Commands:');
  console.log('  create <url>              Create a new session with URL');
  console.log('  list                      List all sessions');
  console.log('  ask <sessionId> <question> Ask a question to a session');
  console.log('  help                      Show this help message');
  console.log('  exit                      Exit the CLI\n');
  console.log('Examples:');
  console.log('  create file:///path/to/page.html');
  console.log('  list');
  console.log('  ask abc-123 "What is this article about?"\n');
}

function connectToApp(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    
    socket.on('connect', () => {
      console.log(colorize('✅ Connected to AI Browser', 'green'));
      resolve(socket);
    });

    socket.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED') {
        console.error(colorize('❌ Could not connect to AI Browser', 'red'));
        console.error('   Make sure the app is running first');
        console.error('   Start it with: npm run dev:start');
      } else {
        console.error(colorize(`❌ Connection error: ${err.message}`, 'red'));
      }
      reject(err);
    });

    socket.connect(CLI_PORT, CLI_HOST);
  });
}

function sendCommand(socket: net.Socket, command: CLICommand): Promise<CLIResponse> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(command) + '\n';
    
    socket.write(data, (err) => {
      if (err) {
        reject(err);
        return;
      }
    });

    // Wait for response
    const timeout = setTimeout(() => {
      reject(new Error('Command timeout'));
    }, 30000); // 30 second timeout

    socket.once('data', (data: Buffer) => {
      clearTimeout(timeout);
      try {
        const response: CLIResponse = JSON.parse(data.toString());
        resolve(response);
      } catch (err) {
        reject(new Error('Invalid response format'));
      }
    });
  });
}

async function handleCommand(socket: net.Socket, command: string, args: string[]): Promise<void> {
  try {
    let cliCommand: CLICommand;

    switch (command) {
      case 'create':
        if (args.length === 0) {
          console.error(colorize('❌ Usage: create <url>', 'red'));
          return;
        }
        cliCommand = {
          type: 'create-session',
          url: args[0],
        };
        break;

      case 'list':
        cliCommand = {
          type: 'list-sessions',
        };
        break;

      case 'ask':
        if (args.length < 2) {
          console.error(colorize('❌ Usage: ask <sessionId> <question>', 'red'));
          return;
        }
        cliCommand = {
          type: 'ask-question',
          sessionId: args[0],
          question: args.slice(1).join(' '),
        };
        break;

      case 'help':
        printHelp();
        return;

      case 'exit':
      case 'quit':
        console.log(colorize('👋 Goodbye!', 'cyan'));
        socket.end();
        process.exit(0);
        return;

      default:
        console.error(colorize(`❌ Unknown command: ${command}`, 'red'));
        console.log('Type "help" for available commands');
        return;
    }

    const response = await sendCommand(socket, cliCommand);

    if (response.success) {
      if (response.data) {
        console.log(colorize('✅ Success:', 'green'));
        if (typeof response.data === 'string') {
          console.log(response.data);
        } else if (Array.isArray(response.data)) {
          response.data.forEach((item: any, idx: number) => {
            console.log(`\n${idx + 1}. ${item.id || item}`);
            if (item.title) console.log(`   Title: ${item.title}`);
            if (item.url) console.log(`   URL: ${item.url}`);
            if (item.state) console.log(`   State: ${item.state}`);
            if (item.messages) console.log(`   Messages: ${item.messages.length}`);
          });
        } else {
          console.log(JSON.stringify(response.data, null, 2));
        }
      }
    } else {
      console.error(colorize(`❌ Error: ${response.error || 'Unknown error'}`, 'red'));
    }
  } catch (error: any) {
    console.error(colorize(`❌ Command failed: ${error.message}`, 'red'));
  }
}

async function main() {
  const args = process.argv.slice(2);

  // If arguments provided, run as one-shot command
  if (args.length > 0) {
    try {
      const socket = await connectToApp();
      const command = args[0];
      const commandArgs = args.slice(1);
      await handleCommand(socket, command, commandArgs);
      socket.end();
      process.exit(0);
    } catch (error) {
      process.exit(1);
    }
    return;
  }

  // Otherwise, run in interactive mode
  console.log(colorize('\n🤖 AI Browser CLI', 'bright'));
  console.log('Type "help" for commands, "exit" to quit\n');

  try {
    const socket = await connectToApp();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: colorize('ai-browser> ', 'cyan'),
    });

    rl.on('line', async (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) {
        rl.prompt();
        return;
      }

      const parts = trimmed.split(/\s+/);
      const command = parts[0];
      const commandArgs = parts.slice(1);

      await handleCommand(socket, command, commandArgs);
      rl.prompt();
    });

    rl.on('close', () => {
      console.log(colorize('\n👋 Goodbye!', 'cyan'));
      socket.end();
      process.exit(0);
    });

    rl.prompt();
  } catch (error) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(colorize(`❌ Fatal error: ${error.message}`, 'red'));
  process.exit(1);
});


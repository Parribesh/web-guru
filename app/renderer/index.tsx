import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './App.css';

// Provide a browser-safe global for modules that expect Node's global
(window as any).global = window;

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

const root = createRoot(container);
root.render(<App />);

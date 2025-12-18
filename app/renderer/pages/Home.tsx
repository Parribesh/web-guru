// Placeholder home page component
// TODO: Implement new tab page with quick actions, bookmarks, etc.

import React from 'react';

export const Home: React.FC = () => {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      padding: '20px',
      textAlign: 'center'
    }}>
      <h1 style={{ fontSize: '24px', marginBottom: '16px', color: '#495057' }}>
        Welcome to AI Browser
      </h1>
      <p style={{ color: '#6c757d', marginBottom: '24px' }}>
        Start browsing with AI-powered features
      </p>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          style={{
            padding: '12px 24px',
            background: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px'
          }}
          onClick={() => {
            // TODO: Implement navigation to URL
            console.log('Navigate to URL');
          }}
        >
          Enter URL
        </button>

        <button
          style={{
            padding: '12px 24px',
            background: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px'
          }}
          onClick={() => {
            // TODO: Open AI panel
            console.log('Open AI panel');
          }}
        >
          Open AI Assistant
        </button>
      </div>
    </div>
  );
};

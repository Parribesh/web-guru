// Placeholder home page component
// TODO: Implement new tab page with quick actions, bookmarks, etc.

import React from 'react';

interface HomeProps {
  onCreateSession?: (url?: string) => void;
}

export const Home: React.FC<HomeProps> = ({ onCreateSession }) => {
  const handleTestWebsite = async () => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.sessions) {
      console.error('electronAPI.sessions not available');
      return;
    }

    // Get the test booking HTML file path using IPC
    // We'll use a helper function in the main process
    try {
      // For now, construct the path - the main process will handle file:// URL conversion
      // The file is at app/test-booking.html relative to project root
      const testBookingPath = await electronAPI.invoke?.('get-test-booking-url') || 
        'file://' + window.location.origin.replace(/\/renderer.*$/, '') + '/test-booking.html';
      
      console.log('Creating session with test booking website:', testBookingPath);
      const session = await electronAPI.sessions.create({ url: testBookingPath });
      console.log('Session created:', session);
    } catch (error) {
      console.error('Failed to create test session:', error);
    }
  };

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

        <button
          style={{
            padding: '12px 24px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold'
          }}
          onClick={handleTestWebsite}
        >
          🧪 Test Booking Website
        </button>
      </div>
    </div>
  );
};

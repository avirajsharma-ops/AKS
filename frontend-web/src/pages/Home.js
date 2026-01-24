import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import PermissionModal from '../components/PermissionModal';

// Microphone icon
const MicIcon = ({ size = 48 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
  </svg>
);

function Home() {
  const { user, updatePermissions } = useAuth();
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [textInput, setTextInput] = useState('');
  
  const {
    isListening,
    isConnected,
    transcript,
    interimTranscript,
    error,
    aiResponse,
    connect,
    disconnect,
    toggleListening,
    clearTranscript
  } = useAudioRecorder();

  // Check if permission is needed
  useEffect(() => {
    if (user && !user.permissions?.backgroundListening && !user.permissions?.dataCollection) {
      setShowPermissionModal(true);
    }
  }, [user]);

  // Connect to WebSocket when permission granted
  useEffect(() => {
    if (user?.permissions?.backgroundListening) {
      connect();
    }
    
    return () => {
      disconnect();
    };
  }, [user?.permissions?.backgroundListening, connect, disconnect]);

  const handlePermissionGrant = async () => {
    try {
      await updatePermissions({
        backgroundListening: true,
        dataCollection: true,
        agreedToTerms: true
      });
      setShowPermissionModal(false);
    } catch (err) {
      console.error('Failed to update permissions:', err);
    }
  };

  const handlePermissionDeny = () => {
    setShowPermissionModal(false);
  };

  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (textInput.trim()) {
      // Send text input through WebSocket
      // wsService.speak(textInput);
      setTextInput('');
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ textAlign: 'center', paddingTop: '20px', marginBottom: '20px' }}>
        <h2>Hi, {user?.name?.split(' ')[0] || 'there'}! 👋</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '4px' }}>
          {user?.permissions?.backgroundListening 
            ? "I'm listening and learning"
            : "Enable listening to start learning"
          }
        </p>
      </div>

      {/* Connection status */}
      <div className="status" style={{ justifyContent: 'center', marginBottom: '20px' }}>
        <span className={`status-dot ${isConnected ? 'active' : ''}`}></span>
        <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
      </div>

      {/* Error display */}
      {error && (
        <div className="card" style={{ borderColor: 'var(--error)', marginBottom: '16px' }}>
          <p style={{ color: 'var(--error)', fontSize: '14px' }}>{error}</p>
        </div>
      )}

      {/* Microphone button */}
      <div className="mic-container">
        <button
          className={`mic-button ${isListening ? 'listening' : ''}`}
          onClick={toggleListening}
          disabled={!isConnected && !user?.permissions?.backgroundListening}
        >
          <MicIcon />
        </button>
        <p style={{ color: 'var(--text-secondary)' }}>
          {isListening ? 'Tap to stop' : 'Tap to speak'}
        </p>
      </div>

      {/* Transcript display */}
      {(transcript || interimTranscript) && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span className="card-title" style={{ margin: 0 }}>Transcript</span>
            <button 
              onClick={clearTranscript}
              style={{ 
                background: 'none', 
                border: 'none', 
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '13px'
              }}
            >
              Clear
            </button>
          </div>
          <div className="transcript-container" style={{ margin: 0 }}>
            <p className="transcript-text">{transcript}</p>
            {interimTranscript && (
              <p className="transcript-text interim">{interimTranscript}</p>
            )}
          </div>
        </div>
      )}

      {/* AI Response */}
      {aiResponse && (
        <div className="response-bubble">
          <p style={{ fontSize: '14px', marginBottom: '8px', opacity: 0.8 }}>
            Your clone says:
          </p>
          <p>{aiResponse.text}</p>
        </div>
      )}

      {/* Text fallback input */}
      <form onSubmit={handleTextSubmit} style={{ marginTop: '24px' }}>
        <div style={{ display: 'flex', gap: '12px' }}>
          <input
            type="text"
            className="input"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Or type here..."
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn btn-secondary">
            Send
          </button>
        </div>
      </form>

      {/* Quick tips */}
      {!transcript && !isListening && (
        <div className="card" style={{ marginTop: '24px' }}>
          <h3 className="card-title">💡 Tips</h3>
          <ul style={{ 
            color: 'var(--text-secondary)', 
            fontSize: '14px', 
            lineHeight: '1.8',
            paddingLeft: '20px'
          }}>
            <li>Talk naturally about your interests</li>
            <li>Share your opinions on topics you care about</li>
            <li>Mention people and places you know</li>
            <li>The more you share, the better I learn!</li>
          </ul>
        </div>
      )}

      {/* Permission Modal */}
      {showPermissionModal && (
        <PermissionModal
          onAccept={handlePermissionGrant}
          onDecline={handlePermissionDeny}
        />
      )}
    </div>
  );
}

export default Home;

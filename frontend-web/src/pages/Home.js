import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import useAudioPlayer from '../hooks/useAudioPlayer';
import PermissionModal from '../components/PermissionModal';
import wsService from '../services/websocket';

// Microphone icon
const MicIcon = ({ size = 48 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
  </svg>
);

// Speaker icon
const SpeakerIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
  </svg>
);

// Chat icon for conversation mode
const ChatIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
  </svg>
);

function Home() {
  const { user, updatePermissions } = useAuth();
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [aiQuestion, setAiQuestion] = useState(null);
  const [currentMode, setCurrentMode] = useState('monitoring'); // 'monitoring' or 'conversation'
  const messagesEndRef = useRef(null);
  const messageIdCounter = useRef(0);
  
  // Generate unique message ID
  const generateMessageId = () => {
    messageIdCounter.current += 1;
    return `${Date.now()}-${messageIdCounter.current}`;
  };
  
  // Audio player hook
  const { isPlaying, playAudio, stop: stopAudio } = useAudioPlayer();
  
  const {
    isListening,
    isConnected,
    transcript,
    interimTranscript,
    error,
    aiResponse,
    detectedLanguage,
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
    if (user?.permissions?.backgroundListening || user?.permissions?.dataCollection) {
      connect();
    }
    
    return () => {
      disconnect();
    };
  }, [user?.permissions?.backgroundListening, user?.permissions?.dataCollection, connect, disconnect]);

  // Handle AI responses
  useEffect(() => {
    if (aiResponse) {
      setMessages(prev => [...prev, {
        id: generateMessageId(),
        type: 'ai',
        text: aiResponse.text,
        timestamp: new Date()
      }]);
    }
  }, [aiResponse]);

  // Handle transcripts as user messages
  useEffect(() => {
    if (transcript && transcript.trim()) {
      const lastUserMsg = messages.filter(m => m.type === 'user').pop();
      if (!lastUserMsg || lastUserMsg.text !== transcript.trim()) {
        setMessages(prev => {
          // Update existing user message or add new
          const existing = prev.find(m => m.type === 'user' && m.isLive);
          if (existing) {
            return prev.map(m => m.id === existing.id ? { ...m, text: transcript.trim() } : m);
          }
          return [...prev, {
            id: generateMessageId(),
            type: 'user',
            text: transcript.trim(),
            timestamp: new Date(),
            isLive: true
          }];
        });
      }
    }
  }, [transcript]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Listen for WebSocket events
  useEffect(() => {
    const unsubAiQuestion = wsService.on('ai:question', (data) => {
      if (data?.question) {
        setAiQuestion(data.question);
        setMessages(prev => [...prev, {
          id: generateMessageId(),
          type: 'ai-question',
          text: data.question,
          category: data.category,
          timestamp: new Date()
        }]);
      }
    });

    const unsubAudio = wsService.on('audio:response', (data) => {
      if (data?.audio) {
        playAudio(data);
      }
    });
    
    // New: Handle AI voice messages
    const unsubAiVoice = wsService.on('ai:voice', (data) => {
      if (data?.audio) {
        playAudio(data);
      }
    });
    
    // New: Handle AI text responses
    const unsubAiResponse = wsService.on('ai:response', (data) => {
      if (data?.text) {
        setMessages(prev => [...prev, {
          id: generateMessageId(),
          type: 'ai',
          text: data.text,
          timestamp: new Date()
        }]);
      }
    });
    
    // New: Handle mode changes
    const unsubModeChange = wsService.on('mode:change', (data) => {
      console.log('Mode changed:', data.mode);
      setCurrentMode(data.mode);
      setMessages(prev => [...prev, {
        id: generateMessageId(),
        type: 'system',
        text: data.mode === 'conversation' 
          ? '💬 Sameer is listening...' 
          : '🎙️ Back to monitoring',
        timestamp: new Date()
      }]);
    });

    return () => {
      if (typeof unsubAiQuestion === 'function') unsubAiQuestion();
      if (typeof unsubAudio === 'function') unsubAudio();
      if (typeof unsubAiVoice === 'function') unsubAiVoice();
      if (typeof unsubAiResponse === 'function') unsubAiResponse();
      if (typeof unsubModeChange === 'function') unsubModeChange();
    };
  }, [playAudio]);

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
      // Add user message
      setMessages(prev => [...prev, {
        id: generateMessageId(),
        type: 'user',
        text: textInput.trim(),
        timestamp: new Date()
      }]);
      
      // Send through WebSocket
      wsService.send({ type: 'speak', text: textInput.trim() });
      setTextInput('');
    }
  };

  const handleAskAI = () => {
    const question = textInput.trim() || 'Tell me about myself based on what you know';
    setMessages(prev => [...prev, {
      id: generateMessageId(),
      type: 'user',
      text: question,
      timestamp: new Date()
    }]);
    wsService.send({ type: 'ask', text: question });
    setTextInput('');
  };

  const requestAIQuestion = () => {
    wsService.send({ type: 'get_question' });
  };
  
  // Manually trigger conversation mode
  const startConversation = () => {
    wsService.startConversation();
  };
  
  // End conversation mode
  const endConversation = () => {
    wsService.endConversation();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', padding: '16px 0' }}>
        <h2 style={{ margin: 0 }}>Hi, {user?.name?.split(' ')[0] || 'there'}! 👋</h2>
        <div className="status" style={{ justifyContent: 'center', marginTop: '8px' }}>
          <span className={`status-dot ${isConnected ? 'active' : ''}`}></span>
          <span style={{ fontSize: '13px' }}>
            {isConnected 
              ? (currentMode === 'conversation' 
                  ? '💬 Talking to Sameer' 
                  : (isListening ? '🎙️ Sameer is listening...' : 'Connected'))
              : 'Connecting...'}
          </span>
        </div>
        {currentMode === 'conversation' && (
          <div style={{ 
            marginTop: '8px', 
            padding: '4px 12px', 
            background: 'var(--primary)', 
            color: 'white',
            borderRadius: '12px',
            display: 'inline-block',
            fontSize: '12px'
          }}>
            Conversation ends in 5s of silence
          </div>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="card" style={{ borderColor: 'var(--error)', margin: '0 16px 12px' }}>
          <p style={{ color: 'var(--error)', fontSize: '14px', margin: 0 }}>{error}</p>
        </div>
      )}

      {/* Chat messages */}
      <div style={{ 
        flex: 1, 
        overflowY: 'auto', 
        padding: '0 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        {messages.length === 0 && (
          <div className="card" style={{ textAlign: 'center', marginTop: '20px' }}>
            <h3 style={{ marginBottom: '12px' }}>🎙️ Sameer is Active</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '8px' }}>
              I'm listening and learning about you.
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', opacity: 0.8, marginBottom: '12px' }}>
              Say <strong>"Hey Buddy"</strong>, <strong>"Sameer"</strong>, or <strong>"Hello Sameer"</strong> to chat!
            </p>
            <div 
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '20px',
                padding: '8px 16px',
                fontSize: '13px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              🌐 English + Hinglish (fuzzy matching enabled)
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div 
            key={msg.id}
            className={msg.type === 'user' ? 'user-bubble' : (msg.type === 'system' ? 'system-bubble' : 'response-bubble')}
            style={{
              alignSelf: msg.type === 'user' ? 'flex-end' : (msg.type === 'system' ? 'center' : 'flex-start'),
              maxWidth: msg.type === 'system' ? '100%' : '85%',
              animation: 'fadeIn 0.3s ease'
            }}
          >
            {msg.type !== 'user' && msg.type !== 'system' && (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '6px', 
                marginBottom: '6px',
                fontSize: '12px',
                opacity: 0.7
              }}>
                {msg.type === 'ai-question' ? '🤔 Sameer asks:' : '🤖 Sameer:'}
              </div>
            )}
            <p style={{ margin: 0 }}>{msg.text}</p>
            <div style={{ 
              fontSize: '10px', 
              opacity: 0.5, 
              marginTop: '6px',
              textAlign: msg.type === 'user' ? 'right' : 'left'
            }}>
              {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        ))}

        {/* Interim transcript */}
        {interimTranscript && (
          <div className="user-bubble" style={{ opacity: 0.7, alignSelf: 'flex-end' }}>
            <p style={{ margin: 0 }}>{interimTranscript}...</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Microphone and input area */}
      <div style={{ padding: '16px', borderTop: '1px solid var(--border)' }}>
        {/* Mic status indicator */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
          <div 
            className={`mic-indicator ${isListening ? 'listening' : ''} ${currentMode === 'conversation' ? 'conversation' : ''}`}
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: isListening 
                ? (currentMode === 'conversation' ? 'var(--success)' : 'var(--primary)') 
                : 'var(--surface)',
              color: isListening ? 'white' : 'var(--text-secondary)',
              transition: 'all 0.3s ease'
            }}
          >
            <MicIcon size={32} />
          </div>
        </div>

        {/* Text input */}
        <form onSubmit={handleTextSubmit} style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            className="input"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Type a message or question..."
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn btn-secondary" disabled={!textInput.trim()}>
            Send
          </button>
          <button type="button" className="btn btn-primary" onClick={handleAskAI}>
            🧠 Ask
          </button>
        </form>

        {/* Audio indicator */}
        {isPlaying && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            gap: '8px',
            marginTop: '12px',
            color: 'var(--primary)'
          }}>
            <SpeakerIcon /> Speaking...
          </div>
        )}
      </div>

      {/* Permission Modal */}
      {showPermissionModal && (
        <PermissionModal
          onAccept={handlePermissionGrant}
          onDecline={handlePermissionDeny}
        />
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4); }
          50% { transform: scale(1.05); box-shadow: 0 0 0 10px rgba(99, 102, 241, 0); }
        }
        @keyframes glow {
          0%, 100% { box-shadow: 0 0 5px var(--primary), 0 0 10px var(--primary); }
          50% { box-shadow: 0 0 15px var(--primary), 0 0 25px var(--primary); }
        }
        .user-bubble {
          background: var(--primary);
          color: white;
          padding: 12px 16px;
          border-radius: 18px 18px 4px 18px;
        }
        .system-bubble {
          background: var(--surface);
          color: var(--text-secondary);
          padding: 8px 16px;
          border-radius: 12px;
          font-size: 13px;
          text-align: center;
        }
        .mic-indicator.listening {
          animation: pulse 2s infinite;
        }
        .mic-indicator.conversation {
          animation: glow 1.5s infinite;
        }
      `}</style>
    </div>
  );
}

export default Home;

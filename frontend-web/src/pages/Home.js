import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import useAudioPlayer from '../hooks/useAudioPlayer';
import PermissionModal from '../components/PermissionModal';
import FaceAnimation from '../components/FaceAnimation';
import wsService from '../services/websocket';

// Chat bubble icon
const ChatBubbleIcon = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
  </svg>
);

// Close icon
const CloseIcon = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
  </svg>
);

// Send icon
const SendIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
  </svg>
);

function Home() {
  const { user, updatePermissions } = useAuth();
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [currentMode, setCurrentMode] = useState('monitoring');
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef(null);
  const messageIdCounter = useRef(0);
  const faceIframeRef = useRef(null);
  
  const generateMessageId = () => {
    messageIdCounter.current += 1;
    return `${Date.now()}-${messageIdCounter.current}`;
  };
  
  const { isPlaying, playAudio } = useAudioPlayer();
  
  const {
    isListening,
    isConnected,
    transcript,
    interimTranscript,
    error,
    aiResponse,
    connect,
    disconnect
  } = useAudioRecorder();

  // Notify the Face iframe when audio starts/stops playing
  useEffect(() => {
    const iframe = document.querySelector('iframe[title="Face Animation"]');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'audioState', isPlaying }, '*');
    }
  }, [isPlaying]);

  useEffect(() => {
    if (user && !user.permissions?.backgroundListening && !user.permissions?.dataCollection) {
      setShowPermissionModal(true);
    }
  }, [user]);

  useEffect(() => {
    if (user?.permissions?.backgroundListening || user?.permissions?.dataCollection) {
      connect();
    }
    return () => disconnect();
  }, [user?.permissions?.backgroundListening, user?.permissions?.dataCollection, connect, disconnect]);

  useEffect(() => {
    if (aiResponse) {
      const newMsg = {
        id: generateMessageId(),
        type: 'ai',
        text: aiResponse.text,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, newMsg]);
      if (!chatOpen) setUnreadCount(prev => prev + 1);
    }
  }, [aiResponse, chatOpen]);

  useEffect(() => {
    if (transcript && transcript.trim()) {
      setMessages(prev => {
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
  }, [transcript]);

  useEffect(() => {
    if (chatOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setUnreadCount(0);
    }
  }, [messages, chatOpen]);

  useEffect(() => {
    const unsubAudio = wsService.on('audio:response', (data) => {
      if (data?.audio) {
        // Notify iframe about audio starting
        const iframe = document.querySelector('iframe[title="Face Animation"]');
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: 'audioStart', duration: data.duration || 3000 }, '*');
        }
        playAudio(data);
      }
    });
    
    const unsubAiVoice = wsService.on('ai:voice', (data) => {
      if (data?.audio) {
        const iframe = document.querySelector('iframe[title="Face Animation"]');
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: 'audioStart', duration: data.duration || 3000 }, '*');
        }
        playAudio(data);
      }
    });
    
    const unsubAiResponse = wsService.on('ai:response', (data) => {
      if (data?.text) {
        const newMsg = {
          id: generateMessageId(),
          type: 'ai',
          text: data.text,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, newMsg]);
        if (!chatOpen) setUnreadCount(prev => prev + 1);
      }
    });
    
    const unsubModeChange = wsService.on('mode:change', (data) => {
      setCurrentMode(data.mode);
    });

    return () => {
      if (typeof unsubAudio === 'function') unsubAudio();
      if (typeof unsubAiVoice === 'function') unsubAiVoice();
      if (typeof unsubAiResponse === 'function') unsubAiResponse();
      if (typeof unsubModeChange === 'function') unsubModeChange();
    };
  }, [playAudio, chatOpen]);

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

  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (textInput.trim()) {
      setMessages(prev => [...prev, {
        id: generateMessageId(),
        type: 'user',
        text: textInput.trim(),
        timestamp: new Date()
      }]);
      wsService.send({ type: 'speak', text: textInput.trim() });
      setTextInput('');
    }
  };

  return (
    <div style={{ 
      position: 'fixed', 
      top: 0, 
      left: 0, 
      width: '100vw', 
      height: '100vh', 
      background: '#000',
      overflow: 'hidden'
    }}>
      {/* Face Animation - Full Screen */}
      <FaceAnimation />
      
      {/* Status indicator - top */}
      <div style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 16px',
        background: 'rgba(0,0,0,0.6)',
        borderRadius: 20,
        backdropFilter: 'blur(10px)',
        zIndex: 100
      }}>
        <div style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: error ? '#ef4444' : (isListening ? '#22c55e' : (!isConnected ? '#eab308' : '#6366f1')),
          boxShadow: isListening ? '0 0 10px #22c55e' : 'none'
        }} />
        <span style={{ color: '#fff', fontSize: 13 }}>
          {error ? 'Error' : (isListening ? (currentMode === 'conversation' ? 'Talking...' : 'Listening...') : (!isConnected ? 'Connecting...' : 'Ready'))}
        </span>
        {isPlaying && <span style={{ color: '#6366f1', fontSize: 12 }}>🔊</span>}
      </div>

      {/* Chat toggle button */}
      <button
        onClick={() => setChatOpen(!chatOpen)}
        style={{
          position: 'absolute',
          bottom: 24,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: chatOpen ? '#ef4444' : '#6366f1',
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          zIndex: 200,
          transition: 'all 0.3s ease'
        }}
      >
        {chatOpen ? <CloseIcon size={24} /> : <ChatBubbleIcon size={24} />}
        {!chatOpen && unreadCount > 0 && (
          <div style={{
            position: 'absolute',
            top: -4,
            right: -4,
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: '#ef4444',
            color: '#fff',
            fontSize: 12,
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </div>
        )}
      </button>

      {/* Chat Panel */}
      <div style={{
        position: 'absolute',
        bottom: 90,
        right: 24,
        width: 340,
        maxWidth: 'calc(100vw - 48px)',
        height: chatOpen ? 450 : 0,
        maxHeight: 'calc(100vh - 140px)',
        background: 'rgba(15,15,25,0.95)',
        borderRadius: 16,
        overflow: 'hidden',
        transition: 'all 0.3s ease',
        opacity: chatOpen ? 1 : 0,
        transform: chatOpen ? 'translateY(0)' : 'translateY(20px)',
        pointerEvents: chatOpen ? 'auto' : 'none',
        zIndex: 150,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(20px)'
      }}>
        {/* Chat header */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <span style={{ color: '#fff', fontWeight: 600 }}>Chat with Sameer</span>
          <span style={{ 
            fontSize: 11, 
            padding: '4px 8px', 
            background: currentMode === 'conversation' ? '#22c55e' : '#6366f1',
            borderRadius: 10,
            color: '#fff'
          }}>
            {currentMode === 'conversation' ? 'Conversation' : 'Monitoring'}
          </span>
        </div>

        {/* Messages */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 10
        }}>
          {messages.length === 0 && (
            <div style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: 40, fontSize: 14 }}>
              Say "Hey Sameer" or type a message
            </div>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                alignSelf: msg.type === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                padding: '10px 14px',
                borderRadius: msg.type === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: msg.type === 'user' ? '#6366f1' : 'rgba(255,255,255,0.1)',
                color: '#fff',
                fontSize: 14,
                lineHeight: 1.4
              }}
            >
              {msg.type !== 'user' && (
                <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>Sameer</div>
              )}
              {msg.text}
              <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4, textAlign: msg.type === 'user' ? 'right' : 'left' }}>
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))}
          {interimTranscript && (
            <div style={{
              alignSelf: 'flex-end',
              maxWidth: '85%',
              padding: '10px 14px',
              borderRadius: '16px 16px 4px 16px',
              background: 'rgba(99,102,241,0.5)',
              color: '#fff',
              fontSize: 14,
              opacity: 0.7
            }}>
              {interimTranscript}...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleTextSubmit} style={{
          padding: 12,
          borderTop: '1px solid rgba(255,255,255,0.1)',
          display: 'flex',
          gap: 8
        }}>
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Type a message..."
            style={{
              flex: 1,
              padding: '10px 14px',
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              borderRadius: 20,
              color: '#fff',
              fontSize: 14,
              outline: 'none'
            }}
          />
          <button
            type="submit"
            disabled={!textInput.trim()}
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: textInput.trim() ? '#6366f1' : 'rgba(255,255,255,0.1)',
              border: 'none',
              color: '#fff',
              cursor: textInput.trim() ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: textInput.trim() ? 1 : 0.5
            }}
          >
            <SendIcon size={18} />
          </button>
        </form>
      </div>

      {/* Permission Modal */}
      {showPermissionModal && (
        <PermissionModal
          onAccept={handlePermissionGrant}
          onDecline={() => setShowPermissionModal(false)}
        />
      )}
    </div>
  );
}

export default Home;

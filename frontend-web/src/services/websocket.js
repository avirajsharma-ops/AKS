/**
 * WebSocket Service
 * Handles real-time audio streaming to backend
 */

class WebSocketService {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.listeners = new Map();
    this.messageQueue = [];
  }

  connect(token) {
    return new Promise((resolve, reject) => {
      const wsUrl = process.env.REACT_APP_WS_URL || 'ws://localhost:5001/ws/audio';
      
      this.ws = new WebSocket(`${wsUrl}?token=${token}`);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
        // Send queued messages
        while (this.messageQueue.length > 0) {
          const msg = this.messageQueue.shift();
          this.ws.send(msg);
        }
        
        resolve();
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        this.isConnected = false;
        this.emit('disconnected', { code: event.code, reason: event.reason });
        
        // Auto-reconnect
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          setTimeout(() => {
            this.reconnectAttempts++;
            console.log(`Reconnecting... (attempt ${this.reconnectAttempts})`);
            this.connect(token).catch(console.error);
          }, 2000 * Math.pow(2, this.reconnectAttempts));
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.emit('error', error);
        reject(error);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      };
    });
  }

  handleMessage(data) {
    switch (data.type) {
      case 'connected':
        this.emit('connected', data);
        break;
      case 'transcript_interim':
        this.emit('transcript:interim', data);
        break;
      case 'transcript_final':
        this.emit('transcript:final', data);
        break;
      case 'transcript_saved':
        this.emit('transcript:saved', data);
        break;
      case 'analysis':
        this.emit('analysis', data);
        break;
      case 'clone_response':
        this.emit('clone:response', data);
        break;
      case 'audio_response':
        this.emit('audio:response', data);
        break;
      case 'ai_question':
        this.emit('ai:question', data);
        break;
      case 'profile':
        this.emit('profile', data);
        break;
      case 'listening_started':
        this.emit('listening:started', data);
        break;
      case 'paused':
        this.emit('paused', data);
        break;
      case 'resumed':
        this.emit('resumed', data);
        break;
      case 'error':
        this.emit('error', data);
        break;
      case 'ai_voice':
        this.emit('ai:voice', data);
        break;
      case 'ai_response':
        this.emit('ai:response', data);
        break;
      case 'mode_change':
        this.emit('mode:change', data);
        break;
      case 'mode_status':
        this.emit('mode:status', data);
        break;
      default:
        this.emit('message', data);
    }
  }

  // Send audio data
  sendAudio(audioData) {
    if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(audioData);
    }
  }

  // Send text command
  sendCommand(type, data = {}) {
    const message = JSON.stringify({ type, ...data });
    
    if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      this.messageQueue.push(message);
    }
  }

  // Event handling
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
    
    // Return unsubscribe function
    return () => {
      const callbacks = this.listeners.get(event);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
      }
    };
  }

  emit(event, data) {
    const callbacks = this.listeners.get(event) || [];
    callbacks.forEach(cb => {
      try {
        cb(data);
      } catch (err) {
        console.error('Event handler error:', err);
      }
    });
  }

  // Pause listening
  pause() {
    this.sendCommand('pause');
  }

  // Resume listening
  resume() {
    this.sendCommand('resume');
  }

  // Notify backend that AI audio is playing (to pause silence timeout)
  notifyAudioPlaying(durationMs) {
    this.sendCommand('audio_playing', { durationMs });
  }

  // Notify backend that AI audio finished (to resume silence timeout)
  notifyAudioEnded() {
    this.sendCommand('audio_ended');
  }

  // Send text as speech input
  speak(text) {
    this.sendCommand('speak', { text });
  }

  // Ask AI clone
  ask(text) {
    this.sendCommand('ask', { text });
  }

  // Get profile
  getProfile() {
    this.sendCommand('get_profile');
  }

  // Request AI question
  getQuestion() {
    this.sendCommand('get_question');
  }

  // Start conversation mode manually
  startConversation(text = null) {
    this.sendCommand('start_conversation', text ? { text } : {});
  }

  // End conversation mode
  endConversation() {
    this.sendCommand('end_conversation');
  }

  // Get current mode
  getMode() {
    this.sendCommand('get_mode');
  }

  // Generic send method
  send(data) {
    const message = JSON.stringify(data);
    if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      this.messageQueue.push(message);
    }
  }

  // Disconnect
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.listeners.clear();
  }
}

// Singleton instance
const wsService = new WebSocketService();
export default wsService;

import AsyncStorage from '@react-native-async-storage/async-storage';

type EventCallback = (data: any) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private listeners: Map<string, EventCallback[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  async connect(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const token = await AsyncStorage.getItem('accessToken');
      if (!token) {
        reject(new Error('Not authenticated'));
        return;
      }

      const wsUrl = 'ws://10.0.2.2:5000/ws/audio'; // Android emulator

      this.ws = new WebSocket(`${wsUrl}?token=${token}`);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        resolve();
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code);
        this.isConnected = false;
        this.emit('disconnected', { code: event.code });

        // Auto-reconnect
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          setTimeout(() => {
            this.reconnectAttempts++;
            this.connect().catch(console.error);
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

  private handleMessage(data: any) {
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
      case 'clone_response':
        this.emit('clone:response', data);
        break;
      case 'audio_response':
        this.emit('audio:response', data);
        break;
      case 'error':
        this.emit('error', data);
        break;
      default:
        this.emit('message', data);
    }
  }

  sendAudio(audioData: ArrayBuffer) {
    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(audioData);
    }
  }

  sendCommand(type: string, data: any = {}) {
    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...data }));
    }
  }

  on(event: string, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);

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

  private emit(event: string, data: any) {
    const callbacks = this.listeners.get(event) || [];
    callbacks.forEach((cb) => cb(data));
  }

  speak(text: string) {
    this.sendCommand('speak', { text });
  }

  ask(text: string) {
    this.sendCommand('ask', { text });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.listeners.clear();
  }

  getIsConnected(): boolean {
    return this.isConnected;
  }
}

export default new WebSocketService();

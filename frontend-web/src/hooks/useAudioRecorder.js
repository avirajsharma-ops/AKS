import { useState, useEffect, useCallback, useRef } from 'react';
import wsService from '../services/websocket';

export function useAudioRecorder() {
  const [isListening, setIsListening] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState(null);
  const [aiResponse, setAiResponse] = useState(null);
  
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);

  // Connect to WebSocket
  const connect = useCallback(async () => {
    try {
      const token = localStorage.getItem('accessToken');
      if (!token) throw new Error('Not authenticated');

      await wsService.connect(token);
      setIsConnected(true);
      setError(null);
    } catch (err) {
      setError(err.message);
      setIsConnected(false);
    }
  }, []);

  // Disconnect
  const disconnect = useCallback(() => {
    stopListening();
    wsService.disconnect();
    setIsConnected(false);
  }, []);

  // Start listening
  const startListening = useCallback(async () => {
    try {
      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000
        } 
      });
      
      streamRef.current = stream;

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && wsService.isConnected) {
          wsService.sendAudio(event.data);
        }
      };

      mediaRecorder.start(250); // Send chunks every 250ms
      setIsListening(true);
      setError(null);
      
    } catch (err) {
      console.error('Failed to start listening:', err);
      setError(err.message === 'Permission denied' 
        ? 'Microphone permission denied. Please allow access in your browser settings.'
        : err.message
      );
    }
  }, []);

  // Stop listening
  const stopListening = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    setIsListening(false);
  }, []);

  // Toggle listening
  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Setup WebSocket event listeners
  useEffect(() => {
    const unsubscribers = [
      wsService.on('connected', () => setIsConnected(true)),
      wsService.on('disconnected', () => setIsConnected(false)),
      wsService.on('error', (data) => setError(data.message)),
      
      wsService.on('transcript:interim', (data) => {
        setInterimTranscript(data.text);
      }),
      
      wsService.on('transcript:final', (data) => {
        setTranscript(prev => prev + ' ' + data.text);
        setInterimTranscript('');
      }),
      
      wsService.on('clone:response', (data) => {
        setAiResponse(data);
      }),
      
      wsService.on('audio:response', (data) => {
        // Play audio response
        const audioData = `data:audio/mp3;base64,${data.audio}`;
        const audio = new Audio(audioData);
        audio.play().catch(console.error);
      })
    ];

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  return {
    isListening,
    isConnected,
    transcript,
    interimTranscript,
    error,
    aiResponse,
    connect,
    disconnect,
    startListening,
    stopListening,
    toggleListening,
    clearTranscript: () => setTranscript(''),
    clearError: () => setError(null)
  };
}

/**
 * useAudioPlayer Hook
 * Handles playing AI voice responses
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import wsService from '../services/websocket';

export const useAudioPlayer = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef(null);
  const audioQueueRef = useRef([]);
  const isProcessingQueue = useRef(false);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      audioQueueRef.current = [];
    };
  }, []);

  // Process audio queue
  const processQueue = useCallback(async () => {
    if (isProcessingQueue.current || audioQueueRef.current.length === 0) {
      return;
    }

    isProcessingQueue.current = true;
    
    while (audioQueueRef.current.length > 0) {
      const audioData = audioQueueRef.current.shift();
      await playAudioData(audioData);
    }
    
    isProcessingQueue.current = false;
  }, []);

  // Play audio from base64 data
  const playAudioData = useCallback((audioData) => {
    return new Promise((resolve) => {
      try {
        setIsLoading(true);
        
        // Convert base64 to blob
        const byteCharacters = atob(audioData.audio);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'audio/mp3' });
        const url = URL.createObjectURL(blob);
        
        // Create and play audio
        const audio = new Audio(url);
        audioRef.current = audio;
        
        audio.onloadeddata = () => {
          setIsLoading(false);
          setIsPlaying(true);
          // Emit event for echo cancellation
          wsService.emit('ai:speaking:start');
          console.log('🔊 AI speaking - pausing mic');
          audio.play().catch(err => {
            console.error('Audio play error:', err);
            setIsPlaying(false);
            wsService.emit('ai:speaking:end');
            resolve();
          });
        };
        
        audio.onended = () => {
          setIsPlaying(false);
          // Emit event to resume listening
          wsService.emit('ai:speaking:end');
          console.log('🔇 AI finished - resuming mic');
          URL.revokeObjectURL(url);
          resolve();
        };
        
        audio.onerror = (err) => {
          console.error('Audio error:', err);
          setIsLoading(false);
          setIsPlaying(false);
          URL.revokeObjectURL(url);
          resolve();
        };
        
      } catch (error) {
        console.error('Error playing audio:', error);
        setIsLoading(false);
        setIsPlaying(false);
        resolve();
      }
    });
  }, []);

  // Add audio to queue and play
  const playAudio = useCallback((audioData) => {
    audioQueueRef.current.push(audioData);
    processQueue();
  }, [processQueue]);

  // Stop playback
  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    audioQueueRef.current = [];
    setIsPlaying(false);
    setIsLoading(false);
  }, []);

  // Play audio from URL
  const playUrl = useCallback((url) => {
    return new Promise((resolve) => {
      try {
        const audio = new Audio(url);
        audioRef.current = audio;
        
        audio.onloadeddata = () => {
          setIsPlaying(true);
          audio.play().catch(err => {
            console.error('Audio play error:', err);
            setIsPlaying(false);
            resolve();
          });
        };
        
        audio.onended = () => {
          setIsPlaying(false);
          resolve();
        };
        
        audio.onerror = () => {
          setIsPlaying(false);
          resolve();
        };
        
      } catch (error) {
        console.error('Error playing URL:', error);
        resolve();
      }
    });
  }, []);

  return {
    isPlaying,
    isLoading,
    playAudio,
    playUrl,
    stop
  };
};

export default useAudioPlayer;

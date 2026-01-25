/**
 * useAudioPlayer Hook
 * Handles playing AI voice responses
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import wsService from '../services/websocket';

// Global audio context unlock state
let audioUnlocked = false;
let silentAudio = null;

// Unlock audio on first user interaction
const unlockAudio = () => {
  if (audioUnlocked) return;
  
  // Create and play silent audio to unlock
  silentAudio = new Audio('data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjU0AAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwmHAAAAAAD/+9DEAAAIAAaX9AAALgAANIAAAAQAAAaQAAAAgAZBkGQZAAACYJg+D4Pg+D4PnAcBwfB8HwfB8HwIAgCAIAgAAABkGQZBkAAAJg+D4Pg+D4Pg+cBwHB8HwfB8HwfAgCAIAgCAIA//tQxBCAAADSAAAAAAAAANIAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==');
  silentAudio.volume = 0.01;
  silentAudio.play().then(() => {
    audioUnlocked = true;
    console.log('🔓 Audio unlocked for autoplay');
  }).catch(() => {
    // Still locked, will try again on next interaction
  });
};

// Add listeners for user interaction
if (typeof window !== 'undefined') {
  ['click', 'touchstart', 'keydown'].forEach(event => {
    document.addEventListener(event, unlockAudio, { once: false, passive: true });
  });
}

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
          
          // Try to play, with retry on user gesture
          const tryPlay = () => {
            audio.play().then(() => {
              console.log('▶️ Audio playing');
            }).catch(err => {
              if (err.name === 'NotAllowedError') {
                console.log('⏸️ Audio blocked - waiting for user interaction');
                // Wait for user interaction then retry
                const retryPlay = () => {
                  audio.play().catch(() => {});
                  document.removeEventListener('click', retryPlay);
                  document.removeEventListener('touchstart', retryPlay);
                };
                document.addEventListener('click', retryPlay, { once: true });
                document.addEventListener('touchstart', retryPlay, { once: true });
              } else {
                console.error('Audio play error:', err);
                setIsPlaying(false);
                wsService.emit('ai:speaking:end');
                resolve();
              }
            });
          };
          tryPlay();
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

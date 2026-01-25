import { useState, useEffect, useCallback, useRef } from 'react';
import wsService from '../services/websocket';

/**
 * Native Web Speech API hook with auto language detection
 * Uses browser's built-in speech recognition for reliable, real-time transcription
 * Supports Hindi, English, and mixed language (Hinglish)
 */
export function useAudioRecorder() {
  const [isListening, setIsListening] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState(null);
  const [aiResponse, setAiResponse] = useState(null);
  const [detectedLanguage, setDetectedLanguage] = useState('auto'); // Track detected language
  
  const recognitionRef = useRef(null);
  const autoStartedRef = useRef(false);
  const restartTimeoutRef = useRef(null);
  const isListeningRef = useRef(false); // Track listening state for callbacks
  const autoFinalizeTimeoutRef = useRef(null); // Timer to auto-finalize interim text

  // Check if Web Speech API is supported
  const isSupported = useCallback(() => {
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  }, []);

  // Initialize speech recognition with auto language detection
  const initRecognition = useCallback(() => {
    if (!isSupported()) {
      setError('Speech recognition not supported. Please use Chrome browser.');
      return null;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    // Use English-India which handles both English AND Hinglish naturally
    // This will transcribe in Roman script (English letters)
    // Hindi speakers often use Roman script anyway (WhatsApp style)
    recognition.lang = 'en-IN'; // English-India: handles English + Hinglish
    recognition.continuous = true; // Keep listening
    recognition.interimResults = true; // Show results as you speak
    recognition.maxAlternatives = 3; // Get multiple alternatives for better accuracy
    
    return recognition;
  }, [isSupported]);

  // Track if we're paused for echo cancellation
  const isPausedRef = useRef(false);

  // Pause listening (for echo cancellation while AI speaks)
  const pauseListening = useCallback(() => {
    if (isPausedRef.current) return;
    isPausedRef.current = true;
    
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
        console.log('⏸️ Paused listening (AI speaking)');
      } catch (e) {
        // Ignore errors
      }
    }
  }, []);

  // Resume listening (after AI finishes speaking)
  const resumeListening = useCallback(() => {
    if (!isPausedRef.current) return;
    isPausedRef.current = false;
    
    // Only resume if we were listening before
    if (isListeningRef.current && recognitionRef.current) {
      try {
        recognitionRef.current.start();
        console.log('▶️ Resumed listening (AI finished)');
      } catch (e) {
        // May need to recreate recognition
        console.log('🔄 Recreating recognition after pause...');
      }
    }
  }, []);

  // Stop listening
  const stopListening = useCallback(() => {
    isListeningRef.current = false;
    isPausedRef.current = false;
    
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    
    if (autoFinalizeTimeoutRef.current) {
      clearTimeout(autoFinalizeTimeoutRef.current);
      autoFinalizeTimeoutRef.current = null;
    }
    
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      } catch (e) {
        // Ignore errors when stopping
      }
    }
    
    setIsListening(false);
    console.log('🛑 Stopped listening');
  }, []);

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
  }, [stopListening]);

  // Detect language from text (Hindi vs English)
  const detectLanguageFromText = useCallback((text) => {
    // Check for Devanagari script (Hindi)
    const hindiPattern = /[\u0900-\u097F]/;
    if (hindiPattern.test(text)) {
      return 'hi-IN';
    }
    return 'en-IN';
  }, []);

  // Track the last interim text globally (for exact transcription)
  const lastInterimRef = useRef('');
  const lastInterimTimestampRef = useRef(0);
  // Track which result indices we've already processed as final
  const processedFinalIndicesRef = useRef(new Set());

  // Start listening with native speech recognition
  const startListening = useCallback(async () => {
    if (isListeningRef.current) return;
    
    try {
      console.log('🎤 Starting native speech recognition (auto language detection)...');
      
      const recognition = initRecognition();
      if (!recognition) return;
      
      recognitionRef.current = recognition;
      isListeningRef.current = true;
      lastInterimRef.current = '';
      processedFinalIndicesRef.current.clear();

      // Handle speech results
      recognition.onresult = (event) => {
        let newFinalText = '';
        let interimText = '';
        
        // Process all results, but only handle NEW finals
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0].transcript;
          
          if (result.isFinal) {
            // Skip if we already processed this final result
            if (processedFinalIndicesRef.current.has(i)) {
              continue;
            }
            
            // Mark as processed
            processedFinalIndicesRef.current.add(i);
            
            // Use the last interim text if it was recent (within 2 seconds)
            // and is longer than Chrome's "corrected" final
            const timeSinceLastInterim = Date.now() - lastInterimTimestampRef.current;
            const useInterim = timeSinceLastInterim < 2000 && 
                              lastInterimRef.current.length > text.length &&
                              lastInterimRef.current.toLowerCase().startsWith(text.toLowerCase().split(' ')[0]);
            
            const exactText = useInterim ? lastInterimRef.current : text;
            newFinalText += exactText + ' ';
            
            console.log(`✅ Final: "${exactText}" (Chrome gave: "${text}", interim was: "${lastInterimRef.current}")`);
            lastInterimRef.current = '';
            
            // Clear auto-finalize timer since we got a real final
            if (autoFinalizeTimeoutRef.current) {
              clearTimeout(autoFinalizeTimeoutRef.current);
              autoFinalizeTimeoutRef.current = null;
            }
          } else {
            // Accumulate interim text
            lastInterimTimestampRef.current = Date.now();
            interimText += text;
          }
        }
        
        if (interimText) {
          // Store the FULL accumulated interim text
          lastInterimRef.current = interimText;
          setInterimTranscript(interimText);
          console.log('📝 Interim:', interimText);
          
          // Send "user is speaking" signal to keep conversation alive
          if (wsService.isConnected) {
            wsService.send({
              type: 'user_speaking',
              interim: interimText,
              timestamp: Date.now()
            });
          }
          
          // Auto-finalize interim text after 1.5s of no new speech
          // This fixes Chrome's slow finalization for Hindi/Hinglish
          if (autoFinalizeTimeoutRef.current) {
            clearTimeout(autoFinalizeTimeoutRef.current);
          }
          autoFinalizeTimeoutRef.current = setTimeout(() => {
            const textToFinalize = lastInterimRef.current;
            if (textToFinalize && textToFinalize.trim()) {
              console.log('⏱️ Auto-finalizing after silence:', textToFinalize);
              lastInterimRef.current = '';
              setInterimTranscript('');
              setTranscript(prev => (prev + ' ' + textToFinalize.trim()).trim());
              
              const lang = detectLanguageFromText(textToFinalize);
              setDetectedLanguage(lang === 'hi-IN' ? 'Hindi' : 'English');
              
              // Send auto-finalized text to backend
              if (wsService.isConnected) {
                wsService.send({
                  type: 'transcript',
                  text: textToFinalize.trim(),
                  language: lang,
                  isFinal: true,
                  autoFinalized: true,
                  timestamp: Date.now()
                });
                console.log('📤 Auto-sent to backend:', textToFinalize.trim());
              }
            }
            autoFinalizeTimeoutRef.current = null;
          }, 1500); // 1.5 seconds of silence
        }
        
        // Only send if we have NEW final text (not previously processed)
        if (newFinalText.trim()) {
          const trimmedFinal = newFinalText.trim();
          setTranscript(prev => (prev + ' ' + trimmedFinal).trim());
          setInterimTranscript('');
          
          const lang = detectLanguageFromText(trimmedFinal);
          setDetectedLanguage(lang === 'hi-IN' ? 'Hindi' : 'English');
          
          // Send ONLY the new final transcript to backend via WebSocket
          if (wsService.isConnected) {
            wsService.send({
              type: 'transcript',
              text: trimmedFinal,
              language: lang,
              isFinal: true,
              timestamp: Date.now()
            });
            console.log('📤 Sent to backend:', trimmedFinal);
          }
        }
      };

      // Handle errors
      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        
        if (event.error === 'not-allowed') {
          setError('Microphone permission denied. Please allow access.');
          isListeningRef.current = false;
          setIsListening(false);
        } else if (event.error === 'no-speech') {
          // No speech detected - immediately restart for continuous listening
          console.log('🔄 No speech detected, restarting immediately...');
          if (isListeningRef.current && !isPausedRef.current) {
            try {
              recognition.start();
            } catch (e) {
              // Will handle in onend
            }
          }
        } else if (event.error === 'network') {
          // Network error - retry after short delay
          console.log('🔄 Network error, retrying...');
          setTimeout(() => {
            if (isListeningRef.current && !isPausedRef.current) {
              try {
                recognition.start();
              } catch (e) {
                // Will handle in onend
              }
            }
          }, 500);
        } else if (event.error === 'aborted') {
          // Aborted - restart unless paused
          if (isListeningRef.current && !isPausedRef.current) {
            console.log('🔄 Aborted, restarting...');
            setTimeout(() => {
              try {
                recognition.start();
              } catch (e) {
                // Will handle in onend
              }
            }, 100);
          }
        }
      };

      // Handle end of recognition (auto-restart for continuous listening)
      recognition.onend = () => {
        console.log('🔄 Recognition session ended');
        
        // Don't auto-restart if paused for echo cancellation
        if (isPausedRef.current) {
          console.log('⏸️ Not restarting - paused for echo cancellation');
          return;
        }
        
        // Auto-restart IMMEDIATELY if we're still supposed to be listening
        if (isListeningRef.current) {
          // Use minimal delay to ensure continuous listening
          restartTimeoutRef.current = setTimeout(() => {
            if (isListeningRef.current && !isPausedRef.current) {
              try {
                console.log('🔄 Auto-restarting recognition...');
                if (recognitionRef.current) {
                  recognitionRef.current.start();
                } else {
                  // Create new recognition instance
                  const newRecognition = initRecognition();
                  if (newRecognition) {
                    recognitionRef.current = newRecognition;
                    setupRecognitionHandlers(newRecognition);
                    newRecognition.start();
                  }
                }
              } catch (e) {
                console.log('🔄 Start failed, creating new instance...');
                // Create new recognition instance
                const newRecognition = initRecognition();
                if (newRecognition) {
                  recognitionRef.current = newRecognition;
                  setupRecognitionHandlers(newRecognition);
                  newRecognition.start();
                }
              }
            }
          }, 10); // Minimal delay for continuous listening
        }
      };

      recognition.onstart = () => {
        console.log('🎙️ Now listening (auto language detection: Hindi + English)...');
        setIsListening(true);
      };

      // Store handler setup for reuse
      const setupRecognitionHandlers = (rec) => {
        rec.onresult = recognition.onresult;
        rec.onerror = recognition.onerror;
        rec.onend = recognition.onend;
        rec.onstart = recognition.onstart;
      };

      // Start recognition
      recognition.start();
      setIsListening(true);
      setError(null);
      
    } catch (err) {
      console.error('Failed to start listening:', err);
      setError(err.message);
      isListeningRef.current = false;
    }
  }, [initRecognition, detectLanguageFromText]);

  // Toggle listening
  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Setup WebSocket event listeners and auto-start
  useEffect(() => {
    const handleConnected = () => {
      console.log('🔗 WebSocket connected');
      setIsConnected(true);
      
      // Auto-start listening after connected
      if (!autoStartedRef.current) {
        autoStartedRef.current = true;
        console.log('🚀 Auto-starting speech recognition (Hindi + English)...');
        setTimeout(() => {
          startListening().catch(err => {
            console.error('Auto-start failed:', err);
          });
        }, 500);
      }
    };
    
    // Handle mode changes - restart recognition when returning to monitoring
    const handleModeChange = (data) => {
      console.log('🔄 Mode changed to:', data.mode);
      if (data.mode === 'monitoring') {
        // Ensure recognition restarts when going back to monitoring
        setTimeout(() => {
          // Check if recognition is actually running by checking the ref state
          if (!recognitionRef.current) {
            console.log('🔄 Starting new recognition after mode change...');
            startListening().catch(err => {
              console.error('Failed to start recognition:', err);
            });
          } else {
            // Recognition exists - just let it continue (onend will auto-restart if needed)
            console.log('✅ Recognition already running, continuing...');
          }
        }, 500);
      }
    };
    
    const unsubscribers = [
      wsService.on('connected', handleConnected),
      wsService.on('disconnected', () => setIsConnected(false)),
      wsService.on('error', (data) => setError(data?.message || 'Unknown error')),
      
      wsService.on('clone:response', (data) => {
        if (data) setAiResponse(data);
      }),
      
      wsService.on('audio:response', (data) => {
        // Audio is handled by the useAudioPlayer hook
      }),
      
      wsService.on('mode:change', handleModeChange),
      
      // Echo cancellation: pause/resume recognition when AI speaks
      wsService.on('ai:speaking:start', () => {
        pauseListening();
      }),
      
      wsService.on('ai:speaking:end', () => {
        // Small delay to ensure audio is fully finished
        setTimeout(() => {
          resumeListening();
        }, 300);
      })
    ];

    return () => {
      unsubscribers.forEach(unsub => {
        if (typeof unsub === 'function') {
          unsub();
        }
      });
    };
  }, [startListening, pauseListening, resumeListening]);

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
    detectedLanguage,
    connect,
    disconnect,
    startListening,
    stopListening,
    pauseListening,
    resumeListening,
    toggleListening,
    clearTranscript: () => setTranscript(''),
    clearError: () => setError(null),
    isSupported: isSupported()
  };
}

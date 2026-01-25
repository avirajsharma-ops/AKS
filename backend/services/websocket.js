/**
 * WebSocket Service
 * Handles real-time audio streaming and transcription
 */

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');

const { User, Transcript, Profile, Conversation } = require('../models');
const { createLiveHandler } = require('./deepgramService');
const { generateEmbedding } = require('./embeddingService');
const { analyzeTranscript, updateProfileFromAnalysis, detectQuestion, generateCloneResponse, generateProfileQuestions } = require('./aiService');
const { generateSpeech, isTTSAvailable } = require('./elevenlabsService');
const { 
  generateContextualQuestion, 
  generateProactiveQuestion, 
  generateConversationalResponse,
  hasInterestingContent,
  detectWakeWord,
  extractMessageAfterWakeWord
} = require('./aiMonitorService');

// Store active connections
const connections = new Map();

// Monitor intervals per user
const monitorIntervals = new Map();

// Conversation mode timeouts
const conversationTimeouts = new Map();

// Constants
const MONITOR_INTERVAL_MS = 30000; // 30 seconds
const CONVERSATION_SILENCE_TIMEOUT_MS = 15000; // 15 seconds of silence before returning to monitoring
const MIN_TRANSCRIPTS_FOR_QUESTION = 1; // Minimum new transcripts to trigger question
const AI_NAME = 'Sameer Sagar';

/**
 * Initialize WebSocket server
 * @param {http.Server} server - HTTP server instance
 */
function initializeWebSocket(server) {
  const wss = new WebSocket.Server({ 
    server,
    path: '/ws/audio'
  });

  console.log('🔌 WebSocket server initialized at /ws/audio');

  wss.on('connection', handleConnection);

  // Heartbeat to keep connections alive
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  return wss;
}

/**
 * Handle new WebSocket connection
 * @param {WebSocket} ws - WebSocket connection
 * @param {http.IncomingMessage} req - HTTP request
 */
async function handleConnection(ws, req) {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // Parse URL for token
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    ws.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
    ws.close(4001, 'Authentication required');
    return;
  }

  // Verify token
  let userId;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    userId = decoded.userId;
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
    ws.close(4002, 'Invalid token');
    return;
  }

  // Verify user exists and has permission
  const user = await User.findByUserId(userId);
  if (!user) {
    console.log(`❌ User ${userId} not found`);
    ws.send(JSON.stringify({ type: 'error', message: 'User not found' }));
    ws.close(4003, 'User not found');
    return;
  }

  console.log(`🔍 User permissions:`, user.permissions, `canListen:`, user.canListenInBackground());

  if (!user.canListenInBackground()) {
    console.log(`❌ User ${userId} missing permissions:`, user.permissions);
    ws.send(JSON.stringify({ type: 'error', message: 'Enable listening in settings first' }));
    ws.close(4004, 'Permission denied');
    return;
  }

  // Create session
  const sessionId = uuidv4();
  const connectionState = {
    userId,
    sessionId,
    user,
    ws,
    deepgramHandler: null,
    transcriptBuffer: '',
    lastTranscriptTime: Date.now(),
    audioBuffer: [],
    isProcessing: false,
    // New: Mode tracking
    mode: 'monitoring', // 'monitoring' or 'conversation'
    activeConversation: null, // Active Conversation document
    lastActivityTime: Date.now(),
    lastMonitorCheck: Date.now(),
    newTranscriptsSinceCheck: [],
    questionCooldown: false, // Prevent spam
    pendingQuestion: null // Question waiting to be asked on silence
  };

  // Initialize Deepgram live handler
  connectionState.deepgramHandler = createLiveHandler(
    (result) => handleTranscriptResult(connectionState, result),
    (error) => handleDeepgramError(connectionState, error),
    { language: user.settings.language || 'en' }
  );

  // Store connection
  connections.set(sessionId, connectionState);

  // Start AI monitoring for this session
  startAIMonitoring(connectionState);

  // Send connection success
  ws.send(JSON.stringify({
    type: 'connected',
    sessionId,
    message: 'Connected to AKS audio service',
    mode: 'monitoring'
  }));

  console.log(`✅ User ${userId} connected (session: ${sessionId})`);

  // Handle incoming messages
  ws.on('message', (data, isBinary) => {
    handleIncomingData(connectionState, data, isBinary);
  });

  // Handle close
  ws.on('close', () => {
    stopAIMonitoring(connectionState);
    handleDisconnect(connectionState);
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error(`WebSocket error for ${userId}:`, error);
  });
}

/**
 * Handle incoming data from client
 * @param {Object} state - Connection state
 * @param {Buffer|string} data - Incoming data
 * @param {boolean} isBinary - Is binary data
 */
function handleIncomingData(state, data, isBinary) {
  if (isBinary) {
    // Binary data is audio
    if (state.deepgramHandler && state.deepgramHandler.isReady()) {
      state.deepgramHandler.send(data);
    } else {
      // Buffer audio while Deepgram reconnects
      state.audioBuffer.push(data);
      if (state.audioBuffer.length > 100) {
        state.audioBuffer.shift(); // Prevent memory issues
      }
    }
  } else {
    // Text data is commands
    try {
      const message = JSON.parse(data.toString());
      handleCommand(state, message);
    } catch (error) {
      console.error('Invalid message format:', error);
    }
  }
}

/**
 * Handle text commands from client
 * @param {Object} state - Connection state
 * @param {Object} message - Parsed message
 */
async function handleCommand(state, message) {
  switch (message.type) {
    case 'ping':
      state.ws.send(JSON.stringify({ type: 'pong' }));
      break;

    case 'transcript':
      // Native STT transcript from browser Web Speech API
      if (message.text && message.isFinal) {
        console.log(`📝 Native STT (${message.language || 'hi-IN'}): ${message.text}`);
        await processTranscript(state, message.text, 1.0);
      }
      break;

    case 'user_speaking':
      // User is speaking (interim results) - reset conversation timeout to keep alive
      if (state.mode === 'conversation') {
        // Reset timeout since user is actively speaking
        resetConversationTimeout(state, 0);
        console.log('🗣️ User still speaking, timeout reset');
      }
      break;

    case 'speak':
      // Text-based input fallback
      if (message.text) {
        await processTranscript(state, message.text, 1.0);
      }
      break;

    case 'ask':
      // Direct question to AI clone
      if (message.text) {
        const response = await generateCloneResponse(state.userId, message.text);
        state.ws.send(JSON.stringify({
          type: 'clone_response',
          text: response,
          timestamp: Date.now()
        }));

        // Generate audio response
        if (state.user.settings.voiceId) {
          try {
            const audioBuffer = await generateSpeech(response, {
              voiceId: state.user.settings.voiceId
            });
            state.ws.send(JSON.stringify({
              type: 'audio_response',
              audio: audioBuffer.toString('base64'),
              format: 'mp3'
            }));
          } catch (error) {
            console.error('TTS error:', error);
          }
        }
      }
      break;

    case 'pause':
      // Pause listening
      if (state.deepgramHandler) {
        state.deepgramHandler.close();
      }
      state.ws.send(JSON.stringify({ type: 'paused' }));
      break;

    case 'resume':
      // Resume listening
      if (state.deepgramHandler) {
        state.deepgramHandler.reconnect();
      }
      state.ws.send(JSON.stringify({ type: 'resumed' }));
      break;

    case 'get_profile':
      // Return current profile summary
      const profile = await Profile.getOrCreate(state.userId);
      state.ws.send(JSON.stringify({
        type: 'profile',
        data: profile.getSummary()
      }));
      break;

    case 'get_question':
      // AI asks user a question to learn more
      try {
        const questions = await generateProfileQuestions(state.userId);
        if (questions.length > 0) {
          const question = questions[0];
          state.ws.send(JSON.stringify({
            type: 'ai_question',
            question: question,
            timestamp: Date.now()
          }));

          // Generate audio for the question
          if (state.user.permissions?.voiceCloning) {
            try {
              const audioBuffer = await generateSpeech(question, {});
              if (audioBuffer) {
                state.ws.send(JSON.stringify({
                  type: 'audio_response',
                  audio: audioBuffer.toString('base64'),
                  format: 'mp3'
                }));
              }
            } catch (audioErr) {
              console.error('TTS error for question:', audioErr);
            }
          }
        } else {
          state.ws.send(JSON.stringify({
            type: 'ai_question',
            question: "I'm getting to know you well! Tell me something new about yourself.",
            timestamp: Date.now()
          }));
        }
      } catch (err) {
        console.error('Error generating question:', err);
        state.ws.send(JSON.stringify({
          type: 'ai_question',
          question: "What's on your mind today?",
          timestamp: Date.now()
        }));
      }
      break;
    
    case 'start_conversation':
      // Manually enter conversation mode
      if (state.mode !== 'conversation') {
        await enterConversationMode(state, message.text || null);
      }
      break;
    
    case 'end_conversation':
      // Manually exit conversation mode
      if (state.mode === 'conversation') {
        await exitConversationMode(state, 'user_request');
      }
      break;
    
    case 'audio_playing':
      // Frontend is playing AI audio - pause conversation timeout
      if (state.mode === 'conversation' && conversationTimeouts.has(state.sessionId)) {
        console.log(`⏸️ Audio playing on frontend (${message.durationMs}ms) - pausing timeout`);
        clearTimeout(conversationTimeouts.get(state.sessionId));
        // Set a longer timeout that accounts for the audio duration
        const extendedTimeout = (message.durationMs || 5000) + CONVERSATION_SILENCE_TIMEOUT_MS;
        const timeoutId = setTimeout(() => {
          exitConversationMode(state, 'timeout');
        }, extendedTimeout);
        conversationTimeouts.set(state.sessionId, timeoutId);
        state.lastActivityTime = Date.now();
      }
      break;
    
    case 'audio_ended':
      // Frontend finished playing AI audio - restart normal timeout
      if (state.mode === 'conversation') {
        console.log(`▶️ Audio ended on frontend - starting ${CONVERSATION_SILENCE_TIMEOUT_MS}ms silence timeout`);
        resetConversationTimeout(state, 0);
      }
      break;
    
    case 'get_mode':
      // Get current mode
      state.ws.send(JSON.stringify({
        type: 'mode_status',
        mode: state.mode,
        conversationId: state.activeConversation?._id,
        timestamp: Date.now()
      }));
      break;

    default:
      state.ws.send(JSON.stringify({
        type: 'error',
        message: `Unknown command: ${message.type}`
      }));
  }
}

/**
 * Handle transcript results from Deepgram
 * @param {Object} state - Connection state
 * @param {Object} result - Transcript result
 */
async function handleTranscriptResult(state, result) {
  if (result.type === 'utterance_end') {
    // Process accumulated transcript
    if (state.transcriptBuffer.trim()) {
      await processTranscript(state, state.transcriptBuffer, 0.9);
      state.transcriptBuffer = '';
    }
    
    // On silence (utterance end) in monitoring mode, check if we should ask a question
    if (state.mode === 'monitoring' && !state.questionCooldown && state.pendingQuestion) {
      await askPendingQuestion(state);
    }
    return;
  }

  if (result.type === 'speech_started') {
    state.ws.send(JSON.stringify({ type: 'listening_started' }));
    // Reset conversation timeout if in conversation mode
    if (state.mode === 'conversation') {
      resetConversationTimeout(state);
    }
    return;
  }

  if (!result.text) return;

  // Send interim results to client
  state.ws.send(JSON.stringify({
    type: result.isFinal ? 'transcript_final' : 'transcript_interim',
    text: result.text,
    confidence: result.confidence,
    timestamp: Date.now(),
    mode: state.mode
  }));

  // Accumulate final transcripts
  if (result.isFinal) {
    state.transcriptBuffer += ' ' + result.text;
    state.lastTranscriptTime = Date.now();
    
    // Check for wake word in monitoring mode
    if (state.mode === 'monitoring' && detectWakeWord(result.text)) {
      console.log(`🎯 Wake word detected: "${result.text}"`);
      const messageAfterWake = extractMessageAfterWakeWord(state.transcriptBuffer);
      state.transcriptBuffer = ''; // Clear buffer
      await enterConversationMode(state, messageAfterWake);
      return;
    }
    
    // In conversation mode, handle the input
    if (state.mode === 'conversation') {
      resetConversationTimeout(state);
    }
  }
}

/**
 * Process completed transcript
 * @param {Object} state - Connection state
 * @param {string} text - Transcript text
 * @param {number} confidence - Confidence score
 */
async function processTranscript(state, text, confidence) {
  if (state.isProcessing) return;
  state.isProcessing = true;

  try {
    const trimmedText = text.trim();
    if (trimmedText.length < 3) {
      state.isProcessing = false;
      return;
    }
    
    // *** CHECK FOR WAKE WORD FIRST (before any other processing) ***
    if (state.mode === 'monitoring' && detectWakeWord(trimmedText)) {
      console.log(`🎯 Wake word detected in: "${trimmedText}"`);
      const messageAfterWake = extractMessageAfterWakeWord(trimmedText);
      await enterConversationMode(state, messageAfterWake);
      state.isProcessing = false;
      return;
    }
    
    // Handle conversation mode input
    if (state.mode === 'conversation') {
      await handleConversationModeInput(state, trimmedText);
      state.isProcessing = false;
      return;
    }
    
    // Handle pending question answer (if there's an active question conversation)
    if (state.activeConversation && state.activeConversation.type === 'proactive_question') {
      await handleQuestionAnswer(state, trimmedText);
      // Continue to also save as transcript below
    }

    console.log(`📝 Processing transcript for ${state.userId}: "${trimmedText.substring(0, 50)}..."`);

    // Generate embedding
    const embedding = await generateEmbedding(trimmedText);

    // Save transcript
    const transcript = new Transcript({
      userId: state.userId,
      sessionId: state.sessionId,
      content: trimmedText,
      embedding,
      metadata: {
        confidence,
        source: 'web',
        isProcessed: false,
        mode: state.mode
      },
      timestamps: {
        recordedAt: new Date()
      }
    });
    await transcript.save();
    
    // Track for AI monitoring (in monitoring mode)
    if (state.mode === 'monitoring') {
      state.newTranscriptsSinceCheck.push({
        content: trimmedText,
        timestamp: Date.now(),
        transcriptId: transcript._id
      });
    }

    // Update user stats
    await User.findOneAndUpdate(
      { userId: state.userId },
      { 
        $inc: { 'stats.totalTranscripts': 1 },
        $set: { 'stats.lastActiveAt': new Date() }
      }
    );

    // Analyze transcript in background
    setImmediate(async () => {
      try {
        const analysis = await analyzeTranscript(trimmedText);
        
        // Update transcript with analysis
        transcript.analysis = {
          entities: analysis.entities || [],
          sentiment: analysis.sentiment || { label: 'neutral' },
          topics: analysis.topics || [],
          isQuestion: analysis.isQuestion || false,
          structuredData: analysis
        };
        transcript.metadata.isProcessed = true;
        transcript.timestamps.processedAt = new Date();
        await transcript.save();

        // Update user profile
        await updateProfileFromAnalysis(state.userId, analysis, trimmedText);

        // Send analysis to client
        state.ws.send(JSON.stringify({
          type: 'analysis',
          transcriptId: transcript._id,
          topics: analysis.topics,
          sentiment: analysis.sentiment
        }));

        // Check if this is a question requiring response OR generate engaging response
        const questionCheck = await detectQuestion(trimmedText);
        
        // Always respond to questions, and sometimes respond to statements to be engaging
        const shouldRespond = questionCheck.requiresResponse || 
          (trimmedText.length > 20 && Math.random() > 0.5); // 50% chance to respond to longer statements
        
        if (shouldRespond) {
          const response = await generateCloneResponse(state.userId, trimmedText);
          
          state.ws.send(JSON.stringify({
            type: 'clone_response',
            text: response,
            inResponseTo: trimmedText,
            timestamp: Date.now()
          }));

          // Generate audio response if enabled
          try {
            const audioBuffer = await generateSpeech(response, {
              voiceId: state.user.settings?.voiceId
            });
            if (audioBuffer) {
              state.ws.send(JSON.stringify({
                type: 'audio_response',
                audio: audioBuffer.toString('base64'),
                format: 'mp3'
              }));
            }
          } catch (ttsError) {
            console.error('TTS error:', ttsError.message);
          }
        }
      } catch (error) {
        console.error('Background analysis error:', error);
      }
    });

    state.ws.send(JSON.stringify({
      type: 'transcript_saved',
      transcriptId: transcript._id
    }));

  } catch (error) {
    console.error('Error processing transcript:', error);
    state.ws.send(JSON.stringify({
      type: 'error',
      message: 'Failed to process transcript'
    }));
  } finally {
    state.isProcessing = false;
  }
}

/**
 * Handle Deepgram errors
 * @param {Object} state - Connection state
 * @param {Error} error - Error object
 */
function handleDeepgramError(state, error) {
  console.error(`Deepgram error for ${state.userId}:`, error);
  
  state.ws.send(JSON.stringify({
    type: 'transcription_error',
    message: 'Speech recognition temporarily unavailable'
  }));

  // Attempt reconnection
  setTimeout(() => {
    if (state.deepgramHandler) {
      state.deepgramHandler.reconnect();
    }
  }, 5001);
}

/**
 * Handle client disconnect
 * @param {Object} state - Connection state
 */
function handleDisconnect(state) {
  console.log(`❌ User ${state.userId} disconnected (session: ${state.sessionId})`);

  // Process any remaining transcript
  if (state.transcriptBuffer.trim()) {
    processTranscript(state, state.transcriptBuffer, 0.8).catch(console.error);
  }

  // Close Deepgram connection
  if (state.deepgramHandler) {
    state.deepgramHandler.close();
  }

  // Remove from active connections
  connections.delete(state.sessionId);
}

/**
 * Get active connection count
 * @returns {number}
 */
function getActiveConnections() {
  return connections.size;
}

/**
 * Get connection by session ID
 * @param {string} sessionId
 * @returns {Object|undefined}
 */
function getConnection(sessionId) {
  return connections.get(sessionId);
}

/**
 * Broadcast message to all connections for a user
 * @param {string} userId
 * @param {Object} message
 */
function broadcastToUser(userId, message) {
  connections.forEach((state) => {
    if (state.userId === userId && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(message));
    }
  });
}

// ============================================
// AI MONITORING & CONVERSATION MODE
// ============================================

/**
 * Start AI monitoring for a connection
 * @param {Object} state - Connection state
 */
function startAIMonitoring(state) {
  console.log(`🤖 Starting AI monitoring for user ${state.userId}`);
  
  // Clear any existing interval
  if (monitorIntervals.has(state.sessionId)) {
    clearInterval(monitorIntervals.get(state.sessionId));
  }
  
  // Set up monitoring interval
  const intervalId = setInterval(async () => {
    await performAICheck(state);
  }, MONITOR_INTERVAL_MS);
  
  monitorIntervals.set(state.sessionId, intervalId);
}

/**
 * Stop AI monitoring for a connection
 * @param {Object} state - Connection state
 */
function stopAIMonitoring(state) {
  console.log(`🛑 Stopping AI monitoring for user ${state.userId}`);
  
  if (monitorIntervals.has(state.sessionId)) {
    clearInterval(monitorIntervals.get(state.sessionId));
    monitorIntervals.delete(state.sessionId);
  }
  
  // Clear conversation timeout if exists
  if (conversationTimeouts.has(state.sessionId)) {
    clearTimeout(conversationTimeouts.get(state.sessionId));
    conversationTimeouts.delete(state.sessionId);
  }
}

/**
 * Perform AI monitoring check
 * @param {Object} state - Connection state
 */
async function performAICheck(state) {
  // Skip if in conversation mode
  if (state.mode === 'conversation') {
    return;
  }
  
  // Skip if on cooldown or already has pending question
  if (state.questionCooldown || state.pendingQuestion) {
    return;
  }
  
  try {
    const newTranscripts = state.newTranscriptsSinceCheck;
    
    // Check if there are new transcripts worth asking about
    if (newTranscripts.length >= MIN_TRANSCRIPTS_FOR_QUESTION) {
      const hasInteresting = await hasInterestingContent(newTranscripts);
      
      if (hasInteresting) {
        // Generate contextual question based on recent speech
        const questionData = await generateContextualQuestion(state.userId, newTranscripts);
        
        if (questionData) {
          // Set as pending question - will be asked on silence detection
          state.pendingQuestion = {
            question: questionData.question,
            category: questionData.category,
            context: questionData.context,
            isProactive: false,
            type: 'follow_up'
          };
          console.log(`📋 Queued follow-up question: "${questionData.question}"`);
        }
      }
    } else {
      // No new transcripts - maybe queue a proactive question (30% chance per check)
      if (Math.random() < 0.3) {
        const proactiveQuestion = await generateProactiveQuestion(state.userId);
        state.pendingQuestion = {
          question: proactiveQuestion.question,
          category: proactiveQuestion.category,
          context: proactiveQuestion.context,
          isProactive: true,
          type: 'psychological'
        };
        console.log(`📋 Queued proactive question: "${proactiveQuestion.question}"`);
      }
    }
    
    // Clear the transcripts buffer
    state.newTranscriptsSinceCheck = [];
    state.lastMonitorCheck = Date.now();
    
  } catch (error) {
    console.error('AI monitoring check error:', error);
  }
}

/**
 * Ask a question to the user with voice
 * @param {Object} state - Connection state
 * @param {string} question - Question text
 * @param {Object} metadata - Question metadata
 */
async function askQuestion(state, question, metadata = {}) {
  if (state.ws.readyState !== WebSocket.OPEN) return;
  
  console.log(`🎙️ Sameer asking: "${question}"`);
  
  // Start cooldown to prevent spam
  state.questionCooldown = true;
  setTimeout(() => { state.questionCooldown = false; }, 45000); // 45 second cooldown
  
  // Create conversation record
  const conversation = await Conversation.createProactiveQuestion(
    state.userId,
    question,
    metadata.category,
    metadata.context
  );
  state.activeConversation = conversation;
  
  // Send question text
  state.ws.send(JSON.stringify({
    type: 'ai_question',
    question: question,
    category: metadata.category,
    conversationId: conversation._id,
    timestamp: Date.now()
  }));
  
  // Generate and send voice (always try to speak)
  if (isTTSAvailable()) {
    try {
      const audioBuffer = await generateSpeech(question);
      if (audioBuffer) {
        state.ws.send(JSON.stringify({
          type: 'ai_voice',
          audio: audioBuffer.toString('base64'),
          format: 'mp3',
          text: question
        }));
        console.log(`🔊 Sameer spoke the question`);
      }
    } catch (ttsError) {
      console.error('TTS error for question:', ttsError.message);
    }
  } else {
    console.log('⚠️ TTS not available, sending text only');
  }
}

/**
 * Ask pending question when silence is detected
 * @param {Object} state - Connection state
 */
async function askPendingQuestion(state) {
  if (!state.pendingQuestion) return;
  
  const pending = state.pendingQuestion;
  state.pendingQuestion = null; // Clear it
  
  await askQuestion(state, pending.question, {
    category: pending.category,
    context: pending.context,
    isProactive: pending.isProactive,
    type: pending.type
  });
}

/**
 * Enter conversation mode (triggered by wake word)
 * @param {Object} state - Connection state
 * @param {string} initialMessage - Optional message after wake word
 */
async function enterConversationMode(state, initialMessage = null) {
  console.log(`💬 Entering conversation mode for user ${state.userId}`);
  
  state.mode = 'conversation';
  
  // Create conversation record
  state.activeConversation = await Conversation.createConversationMode(state.userId, initialMessage);
  
  // Notify client
  state.ws.send(JSON.stringify({
    type: 'mode_change',
    mode: 'conversation',
    conversationId: state.activeConversation._id,
    message: 'Conversation mode activated'
  }));
  
  // Generate greeting or response
  let response;
  if (initialMessage && initialMessage.length > 5) {
    response = await generateConversationalResponse(state.userId, initialMessage, []);
    // Add AI response to conversation
    await state.activeConversation.addMessage('assistant', response);
  } else {
    response = "Hey! I'm Sameer. What's up?";
    await state.activeConversation.addMessage('assistant', response);
  }
  
  // Send response text
  state.ws.send(JSON.stringify({
    type: 'ai_response',
    text: response,
    timestamp: Date.now()
  }));
  
  // Track audio duration for timeout calculation
  let audioDurationMs = 0;
  
  // Send voice
  if (isTTSAvailable()) {
    try {
      const audioBuffer = await generateSpeech(response);
      if (audioBuffer) {
        // Estimate audio duration: MP3 at ~128kbps = ~16KB per second
        // So duration in ms = (buffer size in bytes / 16000) * 1000
        audioDurationMs = Math.ceil((audioBuffer.length / 16000) * 1000);
        // Add a small buffer for network latency
        audioDurationMs += 500;
        
        console.log(`🎤 Audio generated: ${audioBuffer.length} bytes, estimated ${audioDurationMs}ms`);
        
        state.ws.send(JSON.stringify({
          type: 'ai_voice',
          audio: audioBuffer.toString('base64'),
          format: 'mp3',
          text: response,
          durationMs: audioDurationMs
        }));
      }
    } catch (error) {
      console.error('TTS error:', error.message);
    }
  }
  
  // Start silence timeout AFTER audio duration
  resetConversationTimeout(state, audioDurationMs);
}

/**
 * Exit conversation mode (due to silence or user request)
 * @param {Object} state - Connection state
 * @param {string} reason - Exit reason
 */
async function exitConversationMode(state, reason = 'timeout') {
  console.log(`👋 Exiting conversation mode for user ${state.userId} (reason: ${reason})`);
  
  // Clear timeout
  if (conversationTimeouts.has(state.sessionId)) {
    clearTimeout(conversationTimeouts.get(state.sessionId));
    conversationTimeouts.delete(state.sessionId);
  }
  
  // End the conversation record
  if (state.activeConversation) {
    await state.activeConversation.endConversation(reason === 'timeout' ? 'timeout' : 'completed');
    state.activeConversation = null;
  }
  
  state.mode = 'monitoring';
  
  // Notify client
  state.ws.send(JSON.stringify({
    type: 'mode_change',
    mode: 'monitoring',
    message: `Back to listening mode`
  }));
  
  // Brief acknowledgment (no long goodbye to keep it snappy)
  if (reason === 'timeout') {
    const goodbye = "I'm going to sleep now, but I'm still listening everything to study you better ! To wake me up, call my name or just say 'Buddy' ";
    state.ws.send(JSON.stringify({
      type: 'ai_response',
      text: goodbye,
      timestamp: Date.now()
    }));
    
    if (isTTSAvailable()) {
      try {
        const audioBuffer = await generateSpeech(goodbye);
        if (audioBuffer) {
          state.ws.send(JSON.stringify({
            type: 'ai_voice',
            audio: audioBuffer.toString('base64'),
            format: 'mp3',
            text: goodbye
          }));
        }
      } catch (error) {
        console.error('TTS error:', error.message);
      }
    }
  }
}

/**
 * Reset the conversation silence timeout
 * @param {Object} state - Connection state
 * @param {number} audioDurationMs - Duration of audio being played (to delay timeout start)
 */
function resetConversationTimeout(state, audioDurationMs = 0) {
  // Clear existing timeout
  if (conversationTimeouts.has(state.sessionId)) {
    clearTimeout(conversationTimeouts.get(state.sessionId));
  }
  
  // Delay the silence timeout by the audio duration so user has time to respond after AI finishes speaking
  const totalDelayMs = audioDurationMs + CONVERSATION_SILENCE_TIMEOUT_MS;
  
  console.log(`⏱️ Setting silence timeout: ${audioDurationMs}ms audio + ${CONVERSATION_SILENCE_TIMEOUT_MS}ms silence = ${totalDelayMs}ms total`);
  
  // Set new timeout
  const timeoutId = setTimeout(() => {
    exitConversationMode(state, 'timeout');
  }, totalDelayMs);
  
  conversationTimeouts.set(state.sessionId, timeoutId);
  state.lastActivityTime = Date.now();
}

/**
 * Handle user speech in conversation mode
 * @param {Object} state - Connection state
 * @param {string} text - User's speech
 */
async function handleConversationModeInput(state, text) {
  if (!state.activeConversation) {
    await enterConversationMode(state, text);
    return;
  }
  
  // Reset silence timeout
  resetConversationTimeout(state);
  
  // Add user message to conversation
  await state.activeConversation.addMessage('user', text);
  
  // Get conversation history
  const history = state.activeConversation.getHistory();
  
  // Generate AI response
  const response = await generateConversationalResponse(state.userId, text, history);
  
  // Add AI response to conversation
  await state.activeConversation.addMessage('assistant', response);
  
  // Send response text
  state.ws.send(JSON.stringify({
    type: 'ai_response',
    text: response,
    conversationId: state.activeConversation._id,
    timestamp: Date.now()
  }));
  
  // Send voice
  if (isTTSAvailable()) {
    try {
      const audioBuffer = await generateSpeech(response);
      if (audioBuffer) {
        state.ws.send(JSON.stringify({
          type: 'ai_voice',
          audio: audioBuffer.toString('base64'),
          format: 'mp3',
          text: response
        }));
      }
    } catch (error) {
      console.error('TTS error:', error.message);
    }
  }
}

/**
 * Handle answer to proactive question
 * @param {Object} state - Connection state
 * @param {string} answer - User's answer
 */
async function handleQuestionAnswer(state, answer) {
  if (!state.activeConversation) return;
  
  // Add user's answer to conversation
  await state.activeConversation.addMessage('user', answer);
  
  // Generate follow-up or acknowledgment
  const history = state.activeConversation.getHistory();
  const response = await generateConversationalResponse(state.userId, answer, history);
  
  // Add AI response
  await state.activeConversation.addMessage('assistant', response);
  
  // End this conversation (it was just a Q&A)
  await state.activeConversation.endConversation('completed');
  state.activeConversation = null;
  
  // Send response
  state.ws.send(JSON.stringify({
    type: 'ai_response',
    text: response,
    timestamp: Date.now()
  }));
  
  // Send voice
  if (isTTSAvailable()) {
    try {
      const audioBuffer = await generateSpeech(response);
      if (audioBuffer) {
        state.ws.send(JSON.stringify({
          type: 'ai_voice',
          audio: audioBuffer.toString('base64'),
          format: 'mp3',
          text: response
        }));
      }
    } catch (error) {
      console.error('TTS error:', error.message);
    }
  }
}

module.exports = {
  initializeWebSocket,
  getActiveConnections,
  getConnection,
  broadcastToUser,
  enterConversationMode,
  exitConversationMode
};

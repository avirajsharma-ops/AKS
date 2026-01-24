/**
 * WebSocket Service
 * Handles real-time audio streaming and transcription
 */

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');

const { User, Transcript, Profile } = require('../models');
const { createLiveHandler } = require('./deepgramService');
const { generateEmbedding } = require('./embeddingService');
const { analyzeTranscript, updateProfileFromAnalysis, detectQuestion, generateCloneResponse } = require('./aiService');
const { generateSpeech } = require('./elevenlabsService');

// Store active connections
const connections = new Map();

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
    ws.send(JSON.stringify({ type: 'error', message: 'User not found' }));
    ws.close(4003, 'User not found');
    return;
  }

  if (!user.canListenInBackground()) {
    ws.send(JSON.stringify({ type: 'error', message: 'Background listening not permitted' }));
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
    isProcessing: false
  };

  // Initialize Deepgram live handler
  connectionState.deepgramHandler = createLiveHandler(
    (result) => handleTranscriptResult(connectionState, result),
    (error) => handleDeepgramError(connectionState, error),
    { language: user.settings.language || 'en' }
  );

  // Store connection
  connections.set(sessionId, connectionState);

  // Send connection success
  ws.send(JSON.stringify({
    type: 'connected',
    sessionId,
    message: 'Connected to AKS audio service'
  }));

  console.log(`✅ User ${userId} connected (session: ${sessionId})`);

  // Handle incoming messages
  ws.on('message', (data, isBinary) => {
    handleIncomingData(connectionState, data, isBinary);
  });

  // Handle close
  ws.on('close', () => {
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
    return;
  }

  if (result.type === 'speech_started') {
    state.ws.send(JSON.stringify({ type: 'listening_started' }));
    return;
  }

  if (!result.text) return;

  // Send interim results to client
  state.ws.send(JSON.stringify({
    type: result.isFinal ? 'transcript_final' : 'transcript_interim',
    text: result.text,
    confidence: result.confidence,
    timestamp: Date.now()
  }));

  // Accumulate final transcripts
  if (result.isFinal) {
    state.transcriptBuffer += ' ' + result.text;
    state.lastTranscriptTime = Date.now();
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
        isProcessed: false
      },
      timestamps: {
        recordedAt: new Date()
      }
    });
    await transcript.save();

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

        // Check if this is a question requiring response
        const questionCheck = await detectQuestion(trimmedText);
        if (questionCheck.requiresResponse) {
          const response = await generateCloneResponse(state.userId, trimmedText);
          
          state.ws.send(JSON.stringify({
            type: 'clone_response',
            text: response,
            inResponseTo: trimmedText,
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
  }, 5000);
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

module.exports = {
  initializeWebSocket,
  getActiveConnections,
  getConnection,
  broadcastToUser
};

/**
 * Deepgram Service
 * Real-time speech recognition using Deepgram API
 */

const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');

// Initialize Deepgram client
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

/**
 * Transcribe audio buffer (pre-recorded)
 * @param {Buffer} audioBuffer - Audio data
 * @param {Object} options - Transcription options
 * @returns {Promise<Object>} - Transcription result
 */
async function transcribeBuffer(audioBuffer, options = {}) {
  try {
    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
      audioBuffer,
      {
        model: options.model || 'nova-2',
        language: options.language || 'en',
        smart_format: true,
        punctuate: true,
        diarize: false,
        paragraphs: true,
        utterances: true,
        ...options
      }
    );

    if (error) {
      throw error;
    }

    // Extract transcript
    const transcript = result.results.channels[0].alternatives[0];
    
    return {
      text: transcript.transcript,
      confidence: transcript.confidence,
      words: transcript.words,
      paragraphs: transcript.paragraphs,
      duration: result.metadata?.duration || 0
    };
  } catch (error) {
    console.error('Deepgram transcription error:', error);
    throw error;
  }
}

/**
 * Create a live transcription connection
 * @param {Object} options - Live transcription options
 * @returns {Object} - Live transcription connection
 */
function createLiveTranscription(options = {}) {
  const connection = deepgram.listen.live({
    model: options.model || 'nova-2',
    language: options.language || 'en',
    smart_format: true,
    punctuate: true,
    interim_results: true,
    endpointing: 300,
    utterance_end_ms: 1000,
    vad_events: true,
    ...options
  });

  return connection;
}

/**
 * Create WebSocket handler for live transcription
 * @param {Function} onTranscript - Callback for transcript results
 * @param {Function} onError - Callback for errors
 * @returns {Object} - Handler with send and close methods
 */
function createLiveHandler(onTranscript, onError, options = {}) {
  let connection = null;
  let keepAlive = null;
  let isReady = false;

  const initialize = () => {
    connection = createLiveTranscription(options);

    // Connection opened
    connection.on(LiveTranscriptionEvents.Open, () => {
      console.log('Deepgram connection opened');
      isReady = true;

      // Keep connection alive
      keepAlive = setInterval(() => {
        if (connection) {
          connection.keepAlive();
        }
      }, 10000);
    });

    // Transcript received
    connection.on(LiveTranscriptionEvents.Transcript, (data) => {
      const transcript = data.channel?.alternatives[0];
      
      if (transcript && transcript.transcript) {
        onTranscript({
          text: transcript.transcript,
          confidence: transcript.confidence,
          words: transcript.words,
          isFinal: data.is_final,
          speechFinal: data.speech_final,
          start: data.start,
          duration: data.duration
        });
      }
    });

    // Utterance end (natural pause in speech)
    connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
      onTranscript({
        type: 'utterance_end'
      });
    });

    // Speech started
    connection.on(LiveTranscriptionEvents.SpeechStarted, () => {
      onTranscript({
        type: 'speech_started'
      });
    });

    // Connection closed
    connection.on(LiveTranscriptionEvents.Close, () => {
      console.log('Deepgram connection closed');
      isReady = false;
      if (keepAlive) {
        clearInterval(keepAlive);
        keepAlive = null;
      }
    });

    // Error
    connection.on(LiveTranscriptionEvents.Error, (error) => {
      console.error('Deepgram error:', error);
      if (onError) {
        onError(error);
      }
    });

    // Metadata
    connection.on(LiveTranscriptionEvents.Metadata, (data) => {
      console.log('Deepgram metadata:', data);
    });
  };

  // Initialize connection
  initialize();

  return {
    /**
     * Send audio data for transcription
     * @param {Buffer} audioData - Audio chunk
     */
    send: (audioData) => {
      if (connection && isReady) {
        connection.send(audioData);
      }
    },

    /**
     * Check if connection is ready
     * @returns {boolean}
     */
    isReady: () => isReady,

    /**
     * Close the connection
     */
    close: () => {
      if (keepAlive) {
        clearInterval(keepAlive);
        keepAlive = null;
      }
      if (connection) {
        connection.finish();
        connection = null;
      }
      isReady = false;
    },

    /**
     * Reconnect if needed
     */
    reconnect: () => {
      if (connection) {
        connection.finish();
      }
      initialize();
    }
  };
}

/**
 * Transcribe from URL
 * @param {string} audioUrl - URL of audio file
 * @param {Object} options - Transcription options
 * @returns {Promise<Object>} - Transcription result
 */
async function transcribeUrl(audioUrl, options = {}) {
  try {
    const { result, error } = await deepgram.listen.prerecorded.transcribeUrl(
      { url: audioUrl },
      {
        model: options.model || 'nova-2',
        language: options.language || 'en',
        smart_format: true,
        punctuate: true,
        ...options
      }
    );

    if (error) {
      throw error;
    }

    const transcript = result.results.channels[0].alternatives[0];
    
    return {
      text: transcript.transcript,
      confidence: transcript.confidence,
      words: transcript.words,
      duration: result.metadata?.duration || 0
    };
  } catch (error) {
    console.error('Deepgram URL transcription error:', error);
    throw error;
  }
}

module.exports = {
  transcribeBuffer,
  transcribeUrl,
  createLiveTranscription,
  createLiveHandler
};

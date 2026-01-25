/**
 * ElevenLabs TTS Service
 * Text-to-Speech using ElevenLabs API
 */

const { Readable } = require('stream');

// Check if API key is available
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
let elevenlabs = null;
let isAvailable = false;

if (ELEVENLABS_API_KEY && ELEVENLABS_API_KEY.trim() !== '') {
  try {
    const { ElevenLabsClient } = require('elevenlabs');
    elevenlabs = new ElevenLabsClient({
      apiKey: ELEVENLABS_API_KEY
    });
    isAvailable = true;
    console.log('✅ ElevenLabs TTS initialized');
  } catch (err) {
    console.log('⚠️ ElevenLabs SDK not available, TTS disabled');
  }
} else {
  console.log('⚠️ ElevenLabs API key not set, TTS disabled');
}

// Default voice ID from environment (required if using TTS)
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;

if (!DEFAULT_VOICE_ID && isAvailable) {
  console.warn('⚠️ ELEVENLABS_VOICE_ID not set in environment');
}

/**
 * Check if TTS is available
 * @returns {boolean}
 */
function isTTSAvailable() {
  return isAvailable && elevenlabs !== null && DEFAULT_VOICE_ID;
}

/**
 * Generate speech audio from text
 * @param {string} text - Text to convert to speech
 * @param {Object} options - TTS options
 * @returns {Promise<Buffer|null>} - Audio buffer (MP3) or null if TTS unavailable
 */
async function generateSpeech(text, options = {}) {
  if (!elevenlabs) {
    return null; // TTS not available
  }

  try {
    const voiceId = options.voiceId || DEFAULT_VOICE_ID;
    
    // Log the text being sent to ElevenLabs for debugging
    console.log('🔊 Sending to ElevenLabs:', text.substring(0, 100) + (text.length > 100 ? '...' : ''));
    
    const audio = await elevenlabs.generate({
      voice: voiceId,
      text: text,
      // Use multilingual_v2 for Hindi/Devanagari support
      model_id: options.modelId || 'eleven_multilingual_v2',
      voice_settings: {
        stability: options.stability || 0.5,
        similarity_boost: options.similarityBoost || 0.75,
        style: options.style || 0,
        use_speaker_boost: options.useSpeakerBoost || true
      }
    });

    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of audio) {
      chunks.push(chunk);
    }
    
    return Buffer.concat(chunks);
  } catch (error) {
    console.error('ElevenLabs TTS error:', error.message);
    return null;
  }
}

/**
 * Generate speech and return as stream
 * @param {string} text - Text to convert
 * @param {Object} options - TTS options
 * @returns {Promise<ReadableStream>}
 */
async function generateSpeechStream(text, options = {}) {
  try {
    const voiceId = options.voiceId || DEFAULT_VOICE_ID;
    
    const audioStream = await elevenlabs.generate({
      voice: voiceId,
      text: text,
      model_id: options.modelId || 'eleven_monolingual_v1',
      stream: true,
      voice_settings: {
        stability: options.stability || 0.5,
        similarity_boost: options.similarityBoost || 0.75
      }
    });

    return audioStream;
  } catch (error) {
    console.error('ElevenLabs stream error:', error);
    throw error;
  }
}

/**
 * Get available voices
 * @returns {Promise<Array>}
 */
async function getVoices() {
  try {
    const response = await elevenlabs.voices.getAll();
    return response.voices.map(voice => ({
      voiceId: voice.voice_id,
      name: voice.name,
      category: voice.category,
      description: voice.description,
      previewUrl: voice.preview_url,
      labels: voice.labels
    }));
  } catch (error) {
    console.error('Error fetching voices:', error);
    throw error;
  }
}

/**
 * Get voice by ID
 * @param {string} voiceId 
 * @returns {Promise<Object>}
 */
async function getVoice(voiceId) {
  try {
    const voice = await elevenlabs.voices.get(voiceId);
    return {
      voiceId: voice.voice_id,
      name: voice.name,
      category: voice.category,
      description: voice.description,
      previewUrl: voice.preview_url,
      labels: voice.labels,
      settings: voice.settings
    };
  } catch (error) {
    console.error('Error fetching voice:', error);
    throw error;
  }
}

/**
 * Clone voice from audio samples (requires specific plan)
 * @param {string} name - Voice name
 * @param {Buffer[]} audioSamples - Array of audio buffers
 * @param {string} description - Voice description
 * @returns {Promise<Object>}
 */
async function cloneVoice(name, audioSamples, description = '') {
  try {
    // Convert buffers to files
    const files = audioSamples.map((buffer, index) => ({
      name: `sample_${index}.mp3`,
      data: buffer
    }));

    const voice = await elevenlabs.voices.add({
      name: name,
      files: files,
      description: description,
      labels: { type: 'cloned' }
    });

    return {
      voiceId: voice.voice_id,
      name: voice.name
    };
  } catch (error) {
    console.error('Error cloning voice:', error);
    throw error;
  }
}

/**
 * Get user subscription info (for quota management)
 * @returns {Promise<Object>}
 */
async function getSubscriptionInfo() {
  try {
    const subscription = await elevenlabs.user.getSubscription();
    return {
      tier: subscription.tier,
      characterCount: subscription.character_count,
      characterLimit: subscription.character_limit,
      canExtendCharacterLimit: subscription.can_extend_character_limit,
      allowedToExtend: subscription.allowed_to_extend,
      nextCharacterCountResetUnix: subscription.next_character_count_reset_unix
    };
  } catch (error) {
    console.error('Error fetching subscription:', error);
    throw error;
  }
}

/**
 * Generate speech with automatic chunking for long text
 * @param {string} text - Long text to convert
 * @param {Object} options - TTS options
 * @returns {Promise<Buffer>}
 */
async function generateLongSpeech(text, options = {}) {
  const MAX_CHARS = 5001; // ElevenLabs limit per request
  
  if (text.length <= MAX_CHARS) {
    return generateSpeech(text, options);
  }
  
  // Split text into chunks at sentence boundaries
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks = [];
  let currentChunk = '';
  
  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > MAX_CHARS) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  
  // Generate audio for each chunk
  const audioBuffers = await Promise.all(
    chunks.map(chunk => generateSpeech(chunk, options))
  );
  
  // Concatenate audio buffers
  return Buffer.concat(audioBuffers);
}

module.exports = {
  generateSpeech,
  generateSpeechStream,
  generateLongSpeech,
  getVoices,
  getVoice,
  cloneVoice,
  getSubscriptionInfo,
  isTTSAvailable
};

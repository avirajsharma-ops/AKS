/**
 * ElevenLabs TTS Service
 * Text-to-Speech using ElevenLabs API
 */

const { ElevenLabsClient } = require('elevenlabs');
const { Readable } = require('stream');

// Initialize client
const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY
});

// Default voice settings
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

/**
 * Generate speech audio from text
 * @param {string} text - Text to convert to speech
 * @param {Object} options - TTS options
 * @returns {Promise<Buffer>} - Audio buffer (MP3)
 */
async function generateSpeech(text, options = {}) {
  try {
    const voiceId = options.voiceId || DEFAULT_VOICE_ID;
    
    const audio = await elevenlabs.generate({
      voice: voiceId,
      text: text,
      model_id: options.modelId || 'eleven_monolingual_v1',
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
    console.error('ElevenLabs TTS error:', error);
    throw error;
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
  const MAX_CHARS = 5000; // ElevenLabs limit per request
  
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
  getSubscriptionInfo
};

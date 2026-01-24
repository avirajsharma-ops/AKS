/**
 * Speech Routes
 * Handle TTS and STT operations
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { body, validationResult } = require('express-validator');

const { auth } = require('../middleware/auth');
const { generateSpeech, generateSpeechStream, getVoices, getVoice } = require('../services/elevenlabsService');
const { transcribeBuffer } = require('../services/deepgramService');

// Configure multer for audio uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/webm', 'audio/ogg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid audio format'), false);
    }
  }
});

/**
 * POST /api/speech/synthesize
 * Convert text to speech
 */
router.post('/synthesize', auth, [
  body('text').notEmpty().withMessage('Text is required'),
  body('voiceId').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { text, voiceId } = req.body;

    const audioBuffer = await generateSpeech(text, { voiceId });

    // Return as base64 for easy handling in frontend
    res.json({
      audio: audioBuffer.toString('base64'),
      format: 'mp3',
      textLength: text.length
    });

  } catch (error) {
    console.error('TTS error:', error);
    res.status(500).json({ error: 'Speech synthesis failed' });
  }
});

/**
 * POST /api/speech/synthesize/stream
 * Stream text to speech
 */
router.post('/synthesize/stream', auth, [
  body('text').notEmpty().withMessage('Text is required'),
  body('voiceId').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { text, voiceId } = req.body;

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    const stream = await generateSpeechStream(text, { voiceId });

    for await (const chunk of stream) {
      res.write(chunk);
    }

    res.end();

  } catch (error) {
    console.error('TTS stream error:', error);
    res.status(500).json({ error: 'Speech synthesis failed' });
  }
});

/**
 * POST /api/speech/transcribe
 * Transcribe audio file
 */
router.post('/transcribe', auth, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file required' });
    }

    const result = await transcribeBuffer(req.file.buffer, {
      language: req.body.language || 'en'
    });

    res.json({
      transcript: result.text,
      confidence: result.confidence,
      duration: result.duration,
      words: result.words
    });

  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({ error: 'Transcription failed' });
  }
});

/**
 * GET /api/speech/voices
 * Get available TTS voices
 */
router.get('/voices', auth, async (req, res) => {
  try {
    const voices = await getVoices();
    res.json({ voices });
  } catch (error) {
    console.error('Get voices error:', error);
    res.status(500).json({ error: 'Failed to get voices' });
  }
});

/**
 * GET /api/speech/voices/:voiceId
 * Get voice details
 */
router.get('/voices/:voiceId', auth, async (req, res) => {
  try {
    const voice = await getVoice(req.params.voiceId);
    res.json({ voice });
  } catch (error) {
    console.error('Get voice error:', error);
    res.status(500).json({ error: 'Failed to get voice' });
  }
});

module.exports = router;

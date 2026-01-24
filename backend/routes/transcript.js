/**
 * Transcript Routes
 * Manage speech transcripts
 */

const express = require('express');
const router = express.Router();
const { query, param, validationResult } = require('express-validator');

const { Transcript } = require('../models');
const { auth } = require('../middleware/auth');
const { generateEmbedding } = require('../services/embeddingService');

/**
 * GET /api/transcripts
 * Get user's transcripts with pagination
 */
router.get('/', auth, [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('sessionId').optional().isString(),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const page = req.query.page || 1;
    const limit = req.query.limit || 20;
    const skip = (page - 1) * limit;

    // Build query
    const query = {
      userId: req.user.userId,
      isDeleted: false
    };

    if (req.query.sessionId) {
      query.sessionId = req.query.sessionId;
    }

    if (req.query.startDate || req.query.endDate) {
      query['timestamps.recordedAt'] = {};
      if (req.query.startDate) {
        query['timestamps.recordedAt'].$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        query['timestamps.recordedAt'].$lte = new Date(req.query.endDate);
      }
    }

    // Get transcripts
    const [transcripts, total] = await Promise.all([
      Transcript.find(query)
        .sort({ 'timestamps.recordedAt': -1 })
        .skip(skip)
        .limit(limit)
        .select('-embedding')
        .lean(),
      Transcript.countDocuments(query)
    ]);

    res.json({
      transcripts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get transcripts error:', error);
    res.status(500).json({ error: 'Failed to get transcripts' });
  }
});

/**
 * GET /api/transcripts/search
 * Semantic search across transcripts
 */
router.get('/search', auth, [
  query('q').notEmpty().withMessage('Search query required'),
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const searchQuery = req.query.q;
    const limit = req.query.limit || 10;

    // Generate embedding for search query
    const queryEmbedding = await generateEmbedding(searchQuery);

    // Perform vector search
    const results = await Transcript.vectorSearch(
      req.user.userId,
      queryEmbedding,
      limit
    );

    res.json({
      query: searchQuery,
      results
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * GET /api/transcripts/sessions
 * Get list of recording sessions
 */
router.get('/sessions', auth, async (req, res) => {
  try {
    const sessions = await Transcript.aggregate([
      {
        $match: {
          userId: req.user.userId,
          isDeleted: false
        }
      },
      {
        $group: {
          _id: '$sessionId',
          startTime: { $min: '$timestamps.recordedAt' },
          endTime: { $max: '$timestamps.recordedAt' },
          transcriptCount: { $sum: 1 },
          totalConfidence: { $avg: '$metadata.confidence' }
        }
      },
      {
        $sort: { startTime: -1 }
      },
      {
        $limit: 50
      }
    ]);

    res.json({ sessions });

  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Failed to get sessions' });
  }
});

/**
 * GET /api/transcripts/:id
 * Get single transcript
 */
router.get('/:id', auth, [
  param('id').isMongoId()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid transcript ID' });
    }

    const transcript = await Transcript.findOne({
      _id: req.params.id,
      userId: req.user.userId,
      isDeleted: false
    }).select('-embedding');

    if (!transcript) {
      return res.status(404).json({ error: 'Transcript not found' });
    }

    res.json({ transcript });

  } catch (error) {
    console.error('Get transcript error:', error);
    res.status(500).json({ error: 'Failed to get transcript' });
  }
});

/**
 * DELETE /api/transcripts/:id
 * Delete a transcript
 */
router.delete('/:id', auth, [
  param('id').isMongoId()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid transcript ID' });
    }

    const result = await Transcript.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.user.userId
      },
      { $set: { isDeleted: true } },
      { new: true }
    );

    if (!result) {
      return res.status(404).json({ error: 'Transcript not found' });
    }

    res.json({ message: 'Transcript deleted' });

  } catch (error) {
    console.error('Delete transcript error:', error);
    res.status(500).json({ error: 'Failed to delete transcript' });
  }
});

/**
 * GET /api/transcripts/topics/summary
 * Get summary of topics discussed
 */
router.get('/topics/summary', auth, async (req, res) => {
  try {
    const topicSummary = await Transcript.aggregate([
      {
        $match: {
          userId: req.user.userId,
          isDeleted: false,
          'analysis.topics': { $exists: true, $ne: [] }
        }
      },
      {
        $unwind: '$analysis.topics'
      },
      {
        $group: {
          _id: '$analysis.topics',
          count: { $sum: 1 },
          lastMentioned: { $max: '$timestamps.recordedAt' }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 30
      }
    ]);

    res.json({ topics: topicSummary });

  } catch (error) {
    console.error('Get topics error:', error);
    res.status(500).json({ error: 'Failed to get topics' });
  }
});

module.exports = router;

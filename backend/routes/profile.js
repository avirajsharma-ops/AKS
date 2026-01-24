/**
 * Profile Routes
 * Manage AI-learned user profiles
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');

const { Profile } = require('../models');
const { auth } = require('../middleware/auth');
const { generateProfileQuestions, generateCloneResponse } = require('../services/aiService');

/**
 * GET /api/profile
 * Get user's AI profile
 */
router.get('/', auth, async (req, res) => {
  try {
    const profile = await Profile.getOrCreate(req.user.userId);

    res.json({
      profile: profile.getSummary(),
      completeness: profile.quality.completeness,
      dataPoints: profile.quality.dataPoints
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

/**
 * GET /api/profile/full
 * Get full profile (excluding embeddings)
 */
router.get('/full', auth, async (req, res) => {
  try {
    const profile = await Profile.findOne({ userId: req.user.userId })
      .select('-preferences.food.embedding -preferences.entertainment.embedding -preferences.activities.embedding -preferences.general.embedding -knowledgeAreas.embedding -goalsAndAspirations.embedding -opinions.embedding -stories.embedding -profileEmbedding')
      .lean();

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json({ profile });

  } catch (error) {
    console.error('Get full profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

/**
 * PATCH /api/profile/basic
 * Update basic info
 */
router.patch('/basic', auth, [
  body('displayName').optional().trim(),
  body('occupation').optional().trim(),
  body('location').optional().trim(),
  body('timezone').optional().trim(),
  body('languages').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const profile = await Profile.getOrCreate(req.user.userId);
    
    const updateFields = ['displayName', 'occupation', 'location', 'timezone', 'languages'];
    for (const field of updateFields) {
      if (req.body[field] !== undefined) {
        profile.basicInfo[field] = req.body[field];
      }
    }

    profile.calculateCompleteness();
    await profile.save();

    res.json({
      basicInfo: profile.basicInfo,
      completeness: profile.quality.completeness
    });

  } catch (error) {
    console.error('Update basic info error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

/**
 * GET /api/profile/questions
 * Get AI-generated questions to improve profile
 */
router.get('/questions', auth, async (req, res) => {
  try {
    const questions = await generateProfileQuestions(req.user.userId);

    res.json({ questions });

  } catch (error) {
    console.error('Get questions error:', error);
    res.status(500).json({ error: 'Failed to generate questions' });
  }
});

/**
 * POST /api/profile/ask-clone
 * Ask the AI clone a question
 */
router.post('/ask-clone', auth, [
  body('question').notEmpty().withMessage('Question is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const response = await generateCloneResponse(req.user.userId, req.body.question);

    res.json({
      question: req.body.question,
      response
    });

  } catch (error) {
    console.error('Ask clone error:', error);
    res.status(500).json({ error: 'Failed to get response' });
  }
});

/**
 * GET /api/profile/relationships
 * Get relationships
 */
router.get('/relationships', auth, async (req, res) => {
  try {
    const profile = await Profile.getOrCreate(req.user.userId);

    res.json({
      relationships: profile.relationships.sort((a, b) => b.mentions - a.mentions)
    });

  } catch (error) {
    console.error('Get relationships error:', error);
    res.status(500).json({ error: 'Failed to get relationships' });
  }
});

/**
 * GET /api/profile/preferences/:category
 * Get preferences by category
 */
router.get('/preferences/:category', auth, async (req, res) => {
  try {
    const profile = await Profile.getOrCreate(req.user.userId);
    const category = req.params.category;

    if (!profile.preferences[category]) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({
      category,
      preferences: profile.preferences[category].map(p => ({
        item: p.item,
        sentiment: p.sentiment,
        context: p.context,
        confidence: p.confidence,
        learnedAt: p.learnedAt
      }))
    });

  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({ error: 'Failed to get preferences' });
  }
});

/**
 * DELETE /api/profile/preferences/:category/:item
 * Delete a learned preference
 */
router.delete('/preferences/:category/:item', auth, async (req, res) => {
  try {
    const profile = await Profile.getOrCreate(req.user.userId);
    const { category, item } = req.params;

    if (!profile.preferences[category]) {
      return res.status(404).json({ error: 'Category not found' });
    }

    profile.preferences[category] = profile.preferences[category].filter(
      p => p.item.toLowerCase() !== decodeURIComponent(item).toLowerCase()
    );

    await profile.save();

    res.json({ message: 'Preference deleted' });

  } catch (error) {
    console.error('Delete preference error:', error);
    res.status(500).json({ error: 'Failed to delete preference' });
  }
});

/**
 * GET /api/profile/knowledge
 * Get knowledge areas
 */
router.get('/knowledge', auth, async (req, res) => {
  try {
    const profile = await Profile.getOrCreate(req.user.userId);

    res.json({
      knowledgeAreas: profile.knowledgeAreas
        .map(k => ({
          topic: k.topic,
          expertise: k.expertise,
          mentions: k.mentions,
          lastDiscussed: k.lastDiscussed
        }))
        .sort((a, b) => b.mentions - a.mentions)
    });

  } catch (error) {
    console.error('Get knowledge error:', error);
    res.status(500).json({ error: 'Failed to get knowledge areas' });
  }
});

/**
 * POST /api/profile/reset
 * Reset profile (delete all learned data)
 */
router.post('/reset', auth, async (req, res) => {
  try {
    await Profile.deleteOne({ userId: req.user.userId });
    
    // Create fresh profile
    const profile = await Profile.getOrCreate(req.user.userId);

    res.json({
      message: 'Profile reset successfully',
      profile: profile.getSummary()
    });

  } catch (error) {
    console.error('Reset profile error:', error);
    res.status(500).json({ error: 'Failed to reset profile' });
  }
});

module.exports = router;

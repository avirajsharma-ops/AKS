/**
 * User Routes
 * Manage user profiles and permissions
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');

const { User, Profile } = require('../models');
const { auth } = require('../middleware/auth');

/**
 * GET /api/users/me
 * Get current user profile
 */
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findByUserId(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: user.toJSON(),
      profile: await Profile.getOrCreate(user.userId)
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

/**
 * PATCH /api/users/me
 * Update current user
 */
router.patch('/me', auth, [
  body('name').optional().trim().notEmpty(),
  body('settings').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const updates = {};
    const allowedFields = ['name', 'settings'];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        if (field === 'settings') {
          // Merge settings
          updates['settings'] = { ...req.body.settings };
        } else {
          updates[field] = req.body[field];
        }
      }
    }

    const user = await User.findOneAndUpdate(
      { userId: req.user.userId },
      { $set: updates },
      { new: true }
    );

    res.json({ user: user.toJSON() });

  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * POST /api/users/permissions
 * Update user permissions (requires explicit consent)
 */
router.post('/permissions', auth, [
  body('backgroundListening').optional().isBoolean(),
  body('dataCollection').optional().isBoolean(),
  body('voiceCloning').optional().isBoolean(),
  body('shareAnalytics').optional().isBoolean(),
  body('agreedToTerms').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const user = await User.findByUserId(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update permissions
    const permissionFields = ['backgroundListening', 'dataCollection', 'voiceCloning', 'shareAnalytics'];
    for (const field of permissionFields) {
      if (req.body[field] !== undefined) {
        user.permissions[field] = req.body[field];
      }
    }

    // Update consent
    if (req.body.agreedToTerms !== undefined) {
      user.consent.agreedToTerms = req.body.agreedToTerms;
      if (req.body.agreedToTerms) {
        user.consent.agreedAt = new Date();
        user.consent.privacyPolicyVersion = '1.0';
      }
    }

    await user.save();

    // Log permission change for audit
    console.log(`Permission update for ${user.userId}:`, {
      permissions: user.permissions,
      consent: user.consent
    });

    res.json({
      message: 'Permissions updated',
      permissions: user.permissions,
      consent: {
        agreedToTerms: user.consent.agreedToTerms,
        agreedAt: user.consent.agreedAt
      }
    });

  } catch (error) {
    console.error('Permission update error:', error);
    res.status(500).json({ error: 'Failed to update permissions' });
  }
});

/**
 * GET /api/users/permissions
 * Get current permissions
 */
router.get('/permissions', auth, async (req, res) => {
  try {
    const user = await User.findByUserId(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      permissions: user.permissions,
      consent: {
        agreedToTerms: user.consent.agreedToTerms,
        agreedAt: user.consent.agreedAt,
        privacyPolicyVersion: user.consent.privacyPolicyVersion
      },
      canListenInBackground: user.canListenInBackground()
    });

  } catch (error) {
    console.error('Get permissions error:', error);
    res.status(500).json({ error: 'Failed to get permissions' });
  }
});

/**
 * GET /api/users/stats
 * Get user statistics
 */
router.get('/stats', auth, async (req, res) => {
  try {
    const user = await User.findByUserId(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const profile = await Profile.getOrCreate(user.userId);

    res.json({
      stats: user.stats,
      profileCompleteness: profile.quality.completeness,
      dataPoints: profile.quality.dataPoints,
      memberSince: user.createdAt
    });

  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * DELETE /api/users/me
 * Delete user account and all data
 */
router.delete('/me', auth, async (req, res) => {
  try {
    const user = await User.findByUserId(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete profile
    await Profile.deleteOne({ userId: user.userId });

    // Delete transcripts (or mark as deleted)
    const Transcript = require('../models/Transcript');
    await Transcript.updateMany(
      { userId: user.userId },
      { $set: { isDeleted: true } }
    );

    // Mark user as deleted
    user.status = 'deleted';
    user.email = `deleted_${user.userId}@deleted.com`;
    user.name = 'Deleted User';
    user.refreshTokens = [];
    await user.save();

    res.json({ message: 'Account deleted successfully' });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

/**
 * POST /api/users/data-export
 * Export all user data (GDPR compliance)
 */
router.post('/data-export', auth, async (req, res) => {
  try {
    const user = await User.findByUserId(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const profile = await Profile.getOrCreate(user.userId);
    const Transcript = require('../models/Transcript');
    const transcripts = await Transcript.find({ 
      userId: user.userId, 
      isDeleted: false 
    }).select('-embedding').lean();

    const exportData = {
      exportDate: new Date().toISOString(),
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        settings: user.settings,
        permissions: user.permissions,
        stats: user.stats
      },
      profile: profile.toObject(),
      transcripts: transcripts.map(t => ({
        content: t.content,
        recordedAt: t.timestamps.recordedAt,
        analysis: t.analysis
      }))
    };

    res.json(exportData);

  } catch (error) {
    console.error('Data export error:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

module.exports = router;

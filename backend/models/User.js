/**
 * User Model
 * Stores user profiles with permissions and settings
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  userId: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  email: {
    type: String,
    unique: true,
    required: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  
  // Privacy permissions
  permissions: {
    backgroundListening: {
      type: Boolean,
      default: false
    },
    dataCollection: {
      type: Boolean,
      default: false
    },
    voiceCloning: {
      type: Boolean,
      default: false
    },
    shareAnalytics: {
      type: Boolean,
      default: false
    }
  },
  
  // Consent tracking
  consent: {
    agreedToTerms: {
      type: Boolean,
      default: false
    },
    agreedAt: Date,
    privacyPolicyVersion: String
  },
  
  // User settings
  settings: {
    language: {
      type: String,
      default: 'en'
    },
    voiceId: {
      type: String,
      default: '21m00Tcm4TlvDq8ikWAM' // Default ElevenLabs voice
    },
    speechRate: {
      type: Number,
      default: 1.0
    },
    autoListen: {
      type: Boolean,
      default: false
    },
    notificationsEnabled: {
      type: Boolean,
      default: true
    }
  },
  
  // Account status
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended', 'deleted'],
    default: 'active'
  },
  
  // Statistics
  stats: {
    totalTranscripts: {
      type: Number,
      default: 0
    },
    totalMinutesRecorded: {
      type: Number,
      default: 0
    },
    lastActiveAt: Date
  },
  
  // Tokens for sessions
  refreshTokens: [{
    token: String,
    createdAt: {
      type: Date,
      default: Date.now
    },
    expiresAt: Date,
    device: String
  }]
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Update last active
userSchema.methods.updateLastActive = function() {
  this.stats.lastActiveAt = new Date();
  return this.save();
};

// Check if background listening is allowed
userSchema.methods.canListenInBackground = function() {
  return this.permissions.backgroundListening && 
         this.consent.agreedToTerms && 
         this.status === 'active';
};

// Remove sensitive data when converting to JSON
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  delete user.refreshTokens;
  return user;
};

// Static method to find by userId
userSchema.statics.findByUserId = function(userId) {
  return this.findOne({ userId });
};

// Index for faster queries
userSchema.index({ email: 1 });
userSchema.index({ 'stats.lastActiveAt': -1 });

const User = mongoose.model('User', userSchema);

module.exports = User;

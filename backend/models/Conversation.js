/**
 * Conversation Model
 * Stores AI conversations including proactive questions and conversation mode chats
 */

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  metadata: {
    // For questions
    questionCategory: String,
    questionContext: String,
    isProactive: Boolean,
    // For analysis
    sentiment: String,
    topics: [String],
    // For wake word detection
    triggeredByWakeWord: Boolean
  }
});

const conversationSchema = new mongoose.Schema({
  userId: {
    type: String, // Using String to match the UUID format from User model
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['proactive_question', 'conversation_mode', 'follow_up', 'psychological'],
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'timeout', 'interrupted'],
    default: 'active'
  },
  messages: [messageSchema],
  startedAt: {
    type: Date,
    default: Date.now
  },
  endedAt: {
    type: Date
  },
  // Conversation mode specific
  triggeredBy: {
    type: String, // 'wake_word', 'proactive', 'follow_up'
    default: 'proactive'
  },
  // For linking to original transcript that triggered question
  triggerTranscriptId: {
    type: String // Using String for flexibility
  },
  // Summary of conversation for profile building
  summary: {
    type: String
  },
  // Extracted insights for profile
  extractedInsights: [{
    category: String,
    insight: String,
    confidence: Number
  }],
  // Vector embedding for semantic search
  embedding: {
    type: [Number],
    index: '2dsphere'
  }
}, {
  timestamps: true
});

// Indexes
conversationSchema.index({ userId: 1, createdAt: -1 });
conversationSchema.index({ userId: 1, type: 1, createdAt: -1 });

/**
 * Add a message to the conversation
 */
conversationSchema.methods.addMessage = function(role, content, metadata = {}) {
  this.messages.push({
    role,
    content,
    timestamp: new Date(),
    metadata
  });
  return this.save();
};

/**
 * End the conversation
 */
conversationSchema.methods.endConversation = function(status = 'completed', summary = null) {
  this.status = status;
  this.endedAt = new Date();
  if (summary) {
    this.summary = summary;
  }
  return this.save();
};

/**
 * Get conversation history for AI context
 */
conversationSchema.methods.getHistory = function(limit = 10) {
  return this.messages.slice(-limit).map(msg => ({
    role: msg.role,
    content: msg.content
  }));
};

/**
 * Static: Get recent conversations for user
 */
conversationSchema.statics.getRecent = function(userId, limit = 10) {
  return this.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

/**
 * Static: Get active conversation for user
 */
conversationSchema.statics.getActive = function(userId) {
  return this.findOne({
    userId,
    status: 'active'
  }).sort({ createdAt: -1 });
};

/**
 * Static: Create proactive question conversation
 */
conversationSchema.statics.createProactiveQuestion = function(userId, question, category, context) {
  return this.create({
    userId,
    type: 'proactive_question',
    triggeredBy: 'proactive',
    messages: [{
      role: 'assistant',
      content: question,
      metadata: {
        questionCategory: category,
        questionContext: context,
        isProactive: true
      }
    }]
  });
};

/**
 * Static: Create conversation mode session
 */
conversationSchema.statics.createConversationMode = function(userId, initialMessage) {
  return this.create({
    userId,
    type: 'conversation_mode',
    triggeredBy: 'wake_word',
    messages: initialMessage ? [{
      role: 'user',
      content: initialMessage,
      metadata: {
        triggeredByWakeWord: true
      }
    }] : []
  });
};

const Conversation = mongoose.model('Conversation', conversationSchema);

module.exports = Conversation;

/**
 * Transcript Model
 * Stores raw speech transcripts with vector embeddings for semantic search
 */

const mongoose = require('mongoose');

const transcriptSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  
  // Session tracking
  sessionId: {
    type: String,
    required: true,
    index: true
  },
  
  // Raw transcript data
  content: {
    type: String,
    required: true
  },
  
  // Vector embedding for semantic search (1536 dimensions for OpenAI ada-002)
  embedding: {
    type: [Number],
    index: '2dsphere' // For vector search
  },
  
  // Metadata
  metadata: {
    // Audio properties
    duration: {
      type: Number, // in seconds
      default: 0
    },
    confidence: {
      type: Number, // Deepgram confidence score (0-1)
      default: 0
    },
    language: {
      type: String,
      default: 'en'
    },
    
    // Source info
    source: {
      type: String,
      enum: ['web', 'android', 'ios', 'api'],
      default: 'web'
    },
    deviceInfo: {
      type: String
    },
    
    // Processing status
    isProcessed: {
      type: Boolean,
      default: false
    },
    processingError: String,
    
    // Audio file reference (if stored)
    audioFileUrl: String,
    audioFileSize: Number
  },
  
  // Extracted entities and insights
  analysis: {
    // Named entities
    entities: [{
      type: {
        type: String, // person, place, organization, date, etc.
      },
      value: String,
      confidence: Number
    }],
    
    // Detected sentiment
    sentiment: {
      score: Number, // -1 to 1
      label: {
        type: String,
        enum: ['positive', 'negative', 'neutral']
      }
    },
    
    // Topics/keywords
    topics: [String],
    
    // Intent detection
    intent: {
      type: String,
      confidence: Number
    },
    
    // Is this a question?
    isQuestion: {
      type: Boolean,
      default: false
    },
    
    // Structured data extracted
    structuredData: {
      type: mongoose.Schema.Types.Mixed
    }
  },
  
  // Timing information
  timestamps: {
    recordedAt: {
      type: Date,
      default: Date.now
    },
    processedAt: Date,
    embeddedAt: Date
  },
  
  // For conversation threading
  conversationId: String,
  parentTranscriptId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transcript'
  },
  
  // Soft delete
  isDeleted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
transcriptSchema.index({ userId: 1, 'timestamps.recordedAt': -1 });
transcriptSchema.index({ userId: 1, sessionId: 1 });
transcriptSchema.index({ userId: 1, conversationId: 1 });
transcriptSchema.index({ content: 'text' }); // Text search index

// Virtual for word count
transcriptSchema.virtual('wordCount').get(function() {
  return this.content ? this.content.split(/\s+/).length : 0;
});

// Static method for vector search (requires MongoDB Atlas Vector Search index)
transcriptSchema.statics.vectorSearch = async function(userId, embedding, limit = 10) {
  // This requires a Vector Search index named "transcript_embedding_index" in MongoDB Atlas
  // Index definition:
  // {
  //   "mappings": {
  //     "dynamic": true,
  //     "fields": {
  //       "embedding": {
  //         "type": "knnVector",
  //         "dimensions": 1536,
  //         "similarity": "cosine"
  //       }
  //     }
  //   }
  // }
  
  return this.aggregate([
    {
      $vectorSearch: {
        index: "transcript_embedding_index",
        path: "embedding",
        queryVector: embedding,
        numCandidates: limit * 10,
        limit: limit,
        filter: { userId: userId }
      }
    },
    {
      $project: {
        content: 1,
        'timestamps.recordedAt': 1,
        'analysis.topics': 1,
        'metadata.confidence': 1,
        score: { $meta: "vectorSearchScore" }
      }
    }
  ]);
};

// Method to mark as processed
transcriptSchema.methods.markProcessed = function() {
  this.metadata.isProcessed = true;
  this.timestamps.processedAt = new Date();
  return this.save();
};

// Method to add embedding
transcriptSchema.methods.setEmbedding = function(embedding) {
  this.embedding = embedding;
  this.timestamps.embeddedAt = new Date();
  return this.save();
};

// Find recent transcripts for a user
transcriptSchema.statics.getRecentForUser = function(userId, limit = 50) {
  return this.find({ 
    userId, 
    isDeleted: false 
  })
  .sort({ 'timestamps.recordedAt': -1 })
  .limit(limit)
  .select('-embedding'); // Exclude embedding for performance
};

// Get transcripts by session
transcriptSchema.statics.getBySession = function(userId, sessionId) {
  return this.find({ 
    userId, 
    sessionId,
    isDeleted: false 
  })
  .sort({ 'timestamps.recordedAt': 1 })
  .select('-embedding');
};

const Transcript = mongoose.model('Transcript', transcriptSchema);

module.exports = Transcript;

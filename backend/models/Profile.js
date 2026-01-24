/**
 * Profile Model
 * Structured user profile data for AI cloning
 * Contains learned patterns, preferences, and personality traits
 */

const mongoose = require('mongoose');

const profileSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Basic information (learned from speech)
  basicInfo: {
    displayName: String,
    nickname: String,
    occupation: String,
    location: String,
    timezone: String,
    languages: [String],
    birthdate: Date,
    gender: String
  },
  
  // Personal preferences with embeddings for semantic search
  preferences: {
    food: [{
      item: String,
      sentiment: String, // likes, dislikes, neutral
      context: String,
      embedding: [Number],
      confidence: Number,
      learnedAt: Date
    }],
    
    entertainment: [{
      item: String,
      category: String, // movies, music, books, games, etc.
      sentiment: String,
      context: String,
      embedding: [Number],
      learnedAt: Date
    }],
    
    activities: [{
      item: String,
      sentiment: String,
      frequency: String, // daily, weekly, occasionally
      context: String,
      embedding: [Number],
      learnedAt: Date
    }],
    
    general: [{
      category: String,
      item: String,
      sentiment: String,
      context: String,
      embedding: [Number],
      learnedAt: Date
    }]
  },
  
  // Relationships (people mentioned)
  relationships: [{
    name: String,
    relationship: String, // friend, family, colleague, etc.
    mentions: Number,
    contexts: [String],
    sentiment: String,
    lastMentioned: Date
  }],
  
  // Communication style
  communicationStyle: {
    // Speaking patterns
    vocabulary: {
      commonWords: [String],
      uniquePhrases: [String],
      fillerWords: [String],
      averageWordCount: Number
    },
    
    // Tone analysis
    tone: {
      primary: String, // formal, casual, humorous, etc.
      variations: [{
        context: String,
        tone: String
      }]
    },
    
    // Emotional patterns
    emotionalPatterns: {
      dominantEmotion: String,
      emotionFrequency: {
        type: Map,
        of: Number
      }
    },
    
    // Response style
    responseStyle: {
      averageLength: String, // short, medium, long
      usesEmojis: Boolean,
      usesSlang: Boolean,
      formalityLevel: Number // 1-10
    }
  },
  
  // Knowledge areas (what the user knows about)
  knowledgeAreas: [{
    topic: String,
    expertise: String, // beginner, intermediate, expert
    mentions: Number,
    relatedTopics: [String],
    embedding: [Number],
    lastDiscussed: Date
  }],
  
  // Goals and aspirations (mentioned objectives)
  goalsAndAspirations: [{
    goal: String,
    category: String, // career, personal, health, etc.
    status: String, // mentioned, in-progress, achieved
    context: String,
    embedding: [Number],
    mentionedAt: Date
  }],
  
  // Daily routines (patterns detected)
  routines: [{
    activity: String,
    timeOfDay: String,
    frequency: String,
    dayOfWeek: [String],
    confidence: Number
  }],
  
  // Opinions and beliefs
  opinions: [{
    topic: String,
    stance: String, // positive, negative, neutral, mixed
    reasoning: String,
    context: String,
    embedding: [Number],
    confidence: Number,
    learnedAt: Date
  }],
  
  // Stories and experiences (memorable events shared)
  stories: [{
    summary: String,
    fullText: String,
    category: String,
    emotionalTone: String,
    people: [String],
    places: [String],
    embedding: [Number],
    sharedAt: Date
  }],
  
  // Questions the AI should ask (knowledge gaps)
  knowledgeGaps: [{
    area: String,
    question: String,
    priority: Number, // 1-5
    askedBefore: Boolean,
    lastAsked: Date
  }],
  
  // Overall profile embedding (combined representation)
  profileEmbedding: [Number],
  
  // Profile quality metrics
  quality: {
    completeness: Number, // 0-100
    dataPoints: Number,
    lastUpdated: Date,
    needsMoreInfo: [String]
  }
}, {
  timestamps: true
});

// Indexes for search
profileSchema.index({ 'preferences.food.item': 'text', 'preferences.entertainment.item': 'text' });
profileSchema.index({ 'relationships.name': 1 });
profileSchema.index({ 'knowledgeAreas.topic': 1 });

// Method to add a preference
profileSchema.methods.addPreference = function(category, item, sentiment, context, embedding) {
  if (!this.preferences[category]) {
    this.preferences[category] = [];
  }
  
  // Check if preference already exists
  const existing = this.preferences[category].find(p => p.item.toLowerCase() === item.toLowerCase());
  
  if (existing) {
    existing.context = context;
    existing.sentiment = sentiment;
    existing.confidence = (existing.confidence || 0.5) + 0.1;
  } else {
    this.preferences[category].push({
      item,
      sentiment,
      context,
      embedding,
      confidence: 0.5,
      learnedAt: new Date()
    });
  }
  
  return this.save();
};

// Method to add/update a relationship
profileSchema.methods.updateRelationship = function(name, relationship, context, sentiment) {
  const existing = this.relationships.find(r => 
    r.name.toLowerCase() === name.toLowerCase()
  );
  
  if (existing) {
    existing.mentions += 1;
    existing.contexts.push(context);
    existing.sentiment = sentiment;
    existing.lastMentioned = new Date();
  } else {
    this.relationships.push({
      name,
      relationship,
      mentions: 1,
      contexts: [context],
      sentiment,
      lastMentioned: new Date()
    });
  }
  
  return this.save();
};

// Method to get profile summary for AI context
profileSchema.methods.getSummary = function() {
  return {
    basicInfo: this.basicInfo,
    topPreferences: {
      food: this.preferences.food?.slice(0, 5),
      entertainment: this.preferences.entertainment?.slice(0, 5),
      activities: this.preferences.activities?.slice(0, 5)
    },
    relationships: this.relationships.slice(0, 10),
    communicationStyle: this.communicationStyle,
    knowledgeAreas: this.knowledgeAreas.slice(0, 10),
    recentGoals: this.goalsAndAspirations.slice(0, 5),
    quality: this.quality
  };
};

// Method to calculate profile completeness
profileSchema.methods.calculateCompleteness = function() {
  let score = 0;
  const maxScore = 100;
  
  // Basic info (20 points)
  if (this.basicInfo.displayName) score += 5;
  if (this.basicInfo.occupation) score += 5;
  if (this.basicInfo.location) score += 5;
  if (this.basicInfo.languages?.length > 0) score += 5;
  
  // Preferences (30 points)
  if (this.preferences.food?.length >= 3) score += 10;
  if (this.preferences.entertainment?.length >= 3) score += 10;
  if (this.preferences.activities?.length >= 3) score += 10;
  
  // Relationships (15 points)
  if (this.relationships.length >= 5) score += 15;
  else if (this.relationships.length >= 2) score += 8;
  
  // Communication style (15 points)
  if (this.communicationStyle.vocabulary?.commonWords?.length > 0) score += 5;
  if (this.communicationStyle.tone?.primary) score += 5;
  if (this.communicationStyle.responseStyle?.averageLength) score += 5;
  
  // Knowledge areas (10 points)
  if (this.knowledgeAreas.length >= 5) score += 10;
  else if (this.knowledgeAreas.length >= 2) score += 5;
  
  // Goals (10 points)
  if (this.goalsAndAspirations.length >= 2) score += 10;
  
  this.quality.completeness = Math.min(score, maxScore);
  this.quality.lastUpdated = new Date();
  
  return this.quality.completeness;
};

// Static method to get or create profile
profileSchema.statics.getOrCreate = async function(userId) {
  let profile = await this.findOne({ userId });
  
  if (!profile) {
    profile = new this({
      userId,
      basicInfo: {},
      preferences: {
        food: [],
        entertainment: [],
        activities: [],
        general: []
      },
      relationships: [],
      communicationStyle: {
        vocabulary: { commonWords: [], uniquePhrases: [], fillerWords: [] },
        tone: {},
        emotionalPatterns: {},
        responseStyle: {}
      },
      knowledgeAreas: [],
      goalsAndAspirations: [],
      routines: [],
      opinions: [],
      stories: [],
      knowledgeGaps: [],
      quality: {
        completeness: 0,
        dataPoints: 0,
        needsMoreInfo: ['preferences', 'relationships', 'background']
      }
    });
    await profile.save();
  }
  
  return profile;
};

const Profile = mongoose.model('Profile', profileSchema);

module.exports = Profile;

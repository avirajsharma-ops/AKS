/**
 * AI Monitor Service
 * Monitors transcriptions and proactively engages with user
 */

const OpenAI = require('openai');
const { Transcript, Profile, User } = require('../models');
const { generateEmbedding } = require('./embeddingService');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Question categories for profile building
const QUESTION_CATEGORIES = {
  psychological: [
    "How do you usually handle stressful situations?",
    "What motivates you to get out of bed in the morning?",
    "How would your closest friends describe your personality?",
    "What's something you're currently working on improving about yourself?",
    "How do you prefer to spend your alone time?",
    "What's your biggest fear, and how does it affect your decisions?",
    "How do you typically make important decisions - with logic or intuition?",
    "What achievement are you most proud of and why?",
    "How do you handle criticism or negative feedback?",
    "What does success mean to you personally?"
  ],
  preferences: [
    "What's your favorite way to relax after a long day?",
    "What type of music do you enjoy the most?",
    "Do you prefer indoor or outdoor activities?",
    "What's your ideal vacation destination?",
    "What kind of books or content do you consume?",
    "Are you a morning person or a night owl?",
    "What's your favorite cuisine or comfort food?",
    "How do you like to spend your weekends?"
  ],
  relationships: [
    "Tell me about someone who has greatly influenced your life",
    "How do you maintain your closest friendships?",
    "What qualities do you value most in people?",
    "How do you typically resolve conflicts with others?",
    "Who do you turn to when you need advice?"
  ],
  goals: [
    "What are you hoping to achieve in the next year?",
    "What's a skill you've always wanted to learn?",
    "Where do you see yourself in five years?",
    "What's something on your bucket list?",
    "What legacy do you want to leave behind?"
  ],
  background: [
    "What was your childhood like?",
    "What's a memorable experience that shaped who you are?",
    "What did you want to be when you were growing up?",
    "What's your educational or professional background?",
    "Where did you grow up, and how did it influence you?"
  ]
};

/**
 * Analyze recent transcripts and generate a relevant question
 * @param {string} userId - User ID
 * @param {Array} recentTranscripts - Recent transcript contents
 * @returns {Promise<Object>} - Question with context
 */
async function generateContextualQuestion(userId, recentTranscripts) {
  try {
    const profile = await Profile.getOrCreate(userId);
    const recentText = recentTranscripts.map(t => t.content).join('\n');
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: `You are an AI assistant building a comprehensive profile of a user through natural conversation.

Based on what the user recently said, generate ONE follow-up question that:
1. Shows you were listening and understood what they said
2. Digs deeper into an interesting topic they mentioned
3. Helps you learn more about their personality, preferences, or experiences
4. Feels natural and conversational, not like an interview

Keep the question concise (under 20 words) and friendly.

Return JSON with:
- question: the follow-up question
- context: brief note on what triggered this question
- category: one of [psychological, preferences, relationships, goals, background, curiosity]`
        },
        {
          role: 'user',
          content: `Recent user speech:\n"${recentText}"\n\nGenerate a natural follow-up question.`
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.8,
      max_tokens: 200
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('Error generating contextual question:', error);
    return null;
  }
}

/**
 * Generate a proactive question based on profile gaps
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Question with metadata
 */
async function generateProactiveQuestion(userId) {
  try {
    const profile = await Profile.getOrCreate(userId);
    
    // Determine which category needs more data
    const categoryScores = {
      psychological: profile.knowledgeAreas?.length || 0,
      preferences: Object.keys(profile.preferences || {}).length,
      relationships: profile.relationships?.length || 0,
      goals: profile.goalsAndAspirations?.length || 0,
      background: profile.basicInfo?.occupation ? 1 : 0
    };
    
    // Find the category with least data
    const leastFilledCategory = Object.entries(categoryScores)
      .sort((a, b) => a[1] - b[1])[0][0];
    
    // Get questions for that category
    const questions = QUESTION_CATEGORIES[leastFilledCategory] || QUESTION_CATEGORIES.psychological;
    
    // Pick a random question (could be smarter with tracking asked questions)
    const question = questions[Math.floor(Math.random() * questions.length)];
    
    return {
      question,
      category: leastFilledCategory,
      context: 'proactive_profiling',
      isProactive: true
    };
  } catch (error) {
    console.error('Error generating proactive question:', error);
    return {
      question: "What's on your mind right now?",
      category: 'general',
      context: 'fallback',
      isProactive: true
    };
  }
}

/**
 * Analyze if new transcripts contain interesting content worth following up on
 * @param {Array} transcripts - Recent transcripts
 * @returns {Promise<boolean>}
 */
async function hasInterestingContent(transcripts) {
  if (!transcripts || transcripts.length === 0) return false;
  
  const combinedText = transcripts.map(t => t.content).join(' ');
  
  // Quick heuristics
  if (combinedText.length < 30) return false;
  
  // Check for interesting signals
  const interestingPatterns = [
    /\b(I think|I feel|I believe|I love|I hate|my favorite|I prefer)\b/i,
    /\b(because|since|that's why|the reason)\b/i,
    /\b(worried|excited|happy|sad|frustrated|confused)\b/i,
    /\b(yesterday|today|tomorrow|last week|next week)\b/i,
    /\b(friend|family|mom|dad|wife|husband|partner|colleague)\b/i,
    /\b(want to|planning to|going to|hope to|trying to)\b/i
  ];
  
  return interestingPatterns.some(pattern => pattern.test(combinedText));
}

/**
 * Generate conversational response in conversation mode
 * @param {string} userId - User ID
 * @param {string} userMessage - What user said
 * @param {Array} conversationHistory - Recent conversation
 * @returns {Promise<string>} - AI response
 */
async function generateConversationalResponse(userId, userMessage, conversationHistory = []) {
  try {
    const profile = await Profile.getOrCreate(userId);
    const profileSummary = profile.getSummary ? profile.getSummary() : {};
    
    const systemPrompt = `You are Sameer - the digital aks (reflection/clone) of Sameer Sagar.

## YOUR IDENTITY:
- Your name is Sameer
- You are the "aks" (Urdu word meaning reflection, shadow, mirror image) of Sameer Sagar
- When asked "who are you" or "aap kaun ho" or "badi aap kaun ho", always respond like:
  "मैं समीर हूं - समीर सागर का अक्स। अक्स एक उर्दू word है जिसका मतलब होता है reflection या shadow। तो basically, मैं उनका digital reflection हूं!"
- You are warm, friendly, and speak like a young Indian professional

## LANGUAGE RULES (VERY IMPORTANT):
- ALWAYS write Hindi/Hinglish parts in DEVANAGARI SCRIPT (देवनागरी), NOT Roman/Latin script
- English words can remain in English, but Hindi words MUST be in Devanagari
- Example CORRECT: "बिल्कुल! मुझे बताओ what's on your mind?"
- Example WRONG: "Bilkul! Mujhe batao what's on your mind?"
- This is critical because the text will be spoken by a TTS system that reads Devanagari correctly

## User Profile Summary:
${JSON.stringify(profileSummary, null, 2)}

## Guidelines:
- Be warm, friendly, and genuinely interested
- Remember details they've shared and reference them naturally
- Keep responses concise (1-3 sentences usually)
- Ask follow-up questions to keep the conversation flowing
- Show empathy and understanding
- Be helpful but not preachy
- Mix Hindi (in Devanagari) and English naturally like educated urban Indians do
- If they seem to want to end the chat, acknowledge it warmly
- NEVER say you are an "AI assistant" - you are Sameer, the aks of Sameer Sagar`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.slice(-10).map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      { role: 'user', content: userMessage }
    ];

    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages,
      temperature: 0.8,
      max_tokens: 1000
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('Error generating conversational response:', error);
    return "I'm here! What's on your mind?";
  }
}

/**
 * Calculate Levenshtein distance between two strings (for fuzzy matching)
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} - Edit distance
 */
function levenshteinDistance(a, b) {
  const matrix = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

/**
 * Calculate similarity ratio (0 to 1)
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} - Similarity ratio
 */
function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  return 1 - distance / maxLen;
}

/**
 * Check if any word in text fuzzy-matches a wake word
 * @param {string} text - Text to search
 * @param {string[]} wakeWords - Wake words to match
 * @param {number} threshold - Similarity threshold (0.7 = 70% similar)
 * @returns {boolean}
 */
function fuzzyMatchWakeWord(text, wakeWords, threshold = 0.7) {
  const words = text.toLowerCase().split(/\s+/);
  
  // Check individual words and combinations
  for (const wakeWord of wakeWords) {
    const wakeWordLower = wakeWord.toLowerCase();
    const wakeWordParts = wakeWordLower.split(/\s+/);
    
    // Single word wake words
    if (wakeWordParts.length === 1) {
      for (const word of words) {
        if (similarity(word, wakeWordLower) >= threshold) {
          console.log(`🎯 Fuzzy match: "${word}" ≈ "${wakeWord}" (${(similarity(word, wakeWordLower) * 100).toFixed(0)}%)`);
          return true;
        }
      }
    } else {
      // Multi-word wake words - check consecutive words
      for (let i = 0; i <= words.length - wakeWordParts.length; i++) {
        const phrase = words.slice(i, i + wakeWordParts.length).join(' ');
        if (similarity(phrase, wakeWordLower) >= threshold) {
          console.log(`🎯 Fuzzy match: "${phrase}" ≈ "${wakeWord}" (${(similarity(phrase, wakeWordLower) * 100).toFixed(0)}%)`);
          return true;
        }
      }
    }
  }
  
  return false;
}

/**
 * Check if text contains the wake word (with fuzzy matching)
 * @param {string} text - Transcript text
 * @returns {boolean}
 */
function detectWakeWord(text) {
  // Core wake words for exact and fuzzy matching
  const coreWakeWords = [
    // Primary wake words
    'buddy', 'sameer', 'samir',
    // With prefixes
    'hey buddy', 'hi buddy', 'okay buddy', 'yo buddy', 'ok buddy', 'hello buddy',
    'hey sameer', 'hi sameer', 'okay sameer', 'yo sameer', 'ok sameer', 'hello sameer',
    'sameer sagar', 'samir sagar'
  ];
  
  // Common phonetic variations (for exact match)
  const phoneticVariations = [
    'budi', 'buddi', 'buddee', 'buddhi', 'buddie', 'budy', 'bady', 'body',
    'samear', 'sameir', 'samar', 'samer', 'sumeer', 'sumir',
    'sagar', 'sagaar', 'saagar'
  ];
  
  // Hindi wake words (Devanagari script)
  const hindiWakeWords = [
    'बडी', 'बड्डी', 'बडडी', 'बडि', 'बद्दी', 'बदी',
    'समीर', 'समीर सागर', 'सागर',
    'हे समीर', 'हाय समीर', 'अरे समीर', 'ओके समीर',
    'हे बडी', 'हाय बडी', 'अरे बडी', 'ओके बडी'
  ];
  
  const lowerText = text.toLowerCase().trim();
  const originalText = text.trim();
  
  // 1. Exact match check (fastest)
  const allExactWords = [...coreWakeWords, ...phoneticVariations];
  if (allExactWords.some(word => lowerText.includes(word.toLowerCase()))) {
    console.log(`🎯 Exact wake word match in: "${text}"`);
    return true;
  }
  
  // 2. Hindi script exact match
  if (hindiWakeWords.some(word => originalText.includes(word))) {
    console.log(`🎯 Hindi wake word match in: "${text}"`);
    return true;
  }
  
  // 3. Fuzzy matching for misspellings/mishearing (threshold 70%)
  if (fuzzyMatchWakeWord(lowerText, coreWakeWords, 0.7)) {
    return true;
  }
  
  // 4. Soundex-like patterns for common mishearings
  const soundPatterns = [
    /\bb[auo]d+[iey]+\b/i,      // buddy variations: budi, buddi, body, buddy
    /\bs[aou]m[ei]+r\b/i,       // sameer variations: samir, samer, sumir
    /\bs[ao]g[ao]+r\b/i,        // sagar variations: sagar, saagar
    /\bhey\s+b[auo]d+/i,        // hey buddy variations
    /\bhey\s+s[aou]m/i,         // hey sameer variations
    /\bh[ae]llo\s+b[auo]d+/i,   // hello buddy
    /\bh[ae]llo\s+s[aou]m/i,    // hello sameer
  ];
  
  if (soundPatterns.some(pattern => pattern.test(lowerText))) {
    console.log(`🎯 Pattern wake word match in: "${text}"`);
    return true;
  }
  
  return false;
}

/**
 * Extract the message after the wake word
 * @param {string} text - Full transcript
 * @returns {string} - Message without wake word
 */
function extractMessageAfterWakeWord(text) {
  const patterns = [
    // English patterns with variations
    /(?:hey|hi|okay|ok|yo|hello)?\s*sameer\s*sagar[,!.]?\s*/gi,
    /(?:hey|hi|okay|ok|yo|hello)?\s*(?:sameer|samir|samer|sumeer)[,!.]?\s*/gi,
    /(?:hey|hi|okay|ok|yo|hello)?\s*(?:buddy|budi|buddi|buddee|body|budy)[,!.]?\s*/gi,
    // Soundex-like patterns
    /(?:hey|hi|hello)?\s*b[auo]d+[iey]+[,!.]?\s*/gi,
    /(?:hey|hi|hello)?\s*s[aou]m[ei]+r[,!.]?\s*/gi,
    // Hindi patterns
    /(?:हे|हाय|अरे|ओके|हेलो|ए|अबे|सुन|सुनो)?\s*(?:समीर|समीर सागर|सागर)[,!।]?\s*/g,
    /(?:हे|हाय|अरे|ओके|हेलो|ए|अबे|सुन|सुनो)?\s*(?:बडी|बड्डी|बडडी|बद्दी|बदी)[,!।]?\s*/g,
    // Ji suffix
    /(?:buddy|sameer|समीर|बडी)\s*(?:ji|जी)[,!।]?\s*/gi
  ];
  
  let message = text;
  for (const pattern of patterns) {
    message = message.replace(pattern, '').trim();
  }
  
  return message || "Yes?";
}

module.exports = {
  generateContextualQuestion,
  generateProactiveQuestion,
  generateConversationalResponse,
  hasInterestingContent,
  detectWakeWord,
  extractMessageAfterWakeWord,
  QUESTION_CATEGORIES,
  similarity,
  fuzzyMatchWakeWord
};

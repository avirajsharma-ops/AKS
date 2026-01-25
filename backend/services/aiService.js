/**
 * AI Service
 * Handles AI responses, profile analysis, and clone behavior
 */

const OpenAI = require('openai');
const { Profile, Transcript } = require('../models');
const { generateEmbedding, findSimilar } = require('./embeddingService');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Analyze transcript and extract structured information
 * @param {string} text - Transcript text
 * @returns {Promise<Object>} - Extracted information
 */
async function analyzeTranscript(text) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: `You are an AI that analyzes speech transcripts to extract structured information about the speaker.
          
Extract the following if present:
- Entities: names, places, organizations, dates
- Preferences: likes, dislikes (food, activities, entertainment)
- Relationships: people mentioned and their relation
- Topics: main subjects discussed
- Sentiment: overall emotional tone
- Intent: what the speaker wants or is doing
- Facts about themselves: occupation, location, background
- Questions asked
- Goals or aspirations mentioned

Return a JSON object with these categories. Only include information explicitly stated or strongly implied.`
        },
        {
          role: 'user',
          content: `Analyze this transcript:\n\n"${text}"`
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 2000
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('Error analyzing transcript:', error);
    return { error: 'Analysis failed', entities: [], preferences: [], topics: [] };
  }
}

/**
 * Generate AI response as the user's clone
 * @param {string} userId - User ID
 * @param {string} prompt - Input prompt or question
 * @param {Object} context - Additional context
 * @returns {Promise<string>} - AI response
 */
async function generateCloneResponse(userId, prompt, context = {}) {
  try {
    // Get user profile
    const profile = await Profile.getOrCreate(userId);
    const profileSummary = profile.getSummary();
    
    // Get relevant past conversations using semantic search
    const promptEmbedding = await generateEmbedding(prompt);
    const relevantTranscripts = await Transcript.vectorSearch(userId, promptEmbedding, 5);
    
    // Build context from past conversations
    const pastContext = relevantTranscripts
      .map(t => t.content)
      .join('\n---\n');
    
    // Create system prompt based on profile
    const systemPrompt = buildCloneSystemPrompt(profileSummary, pastContext);
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 2000
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('Error generating clone response:', error);
    throw error;
  }
}

/**
 * Build system prompt for clone behavior
 * @param {Object} profile - User profile summary
 * @param {string} pastContext - Relevant past conversations
 * @returns {string}
 */
function buildCloneSystemPrompt(profile, pastContext) {
  let prompt = `You are a digital clone of a person. Your job is to respond as they would, based on their personality, preferences, and communication style.

## User Profile:
`;

  if (profile.basicInfo?.displayName) {
    prompt += `- Name: ${profile.basicInfo.displayName}\n`;
  }
  if (profile.basicInfo?.occupation) {
    prompt += `- Occupation: ${profile.basicInfo.occupation}\n`;
  }
  if (profile.basicInfo?.location) {
    prompt += `- Location: ${profile.basicInfo.location}\n`;
  }

  // Add preferences
  if (profile.topPreferences) {
    prompt += '\n## Preferences:\n';
    if (profile.topPreferences.food?.length > 0) {
      prompt += `- Food: ${profile.topPreferences.food.map(f => `${f.sentiment === 'likes' ? '❤️' : '👎'} ${f.item}`).join(', ')}\n`;
    }
    if (profile.topPreferences.entertainment?.length > 0) {
      prompt += `- Entertainment: ${profile.topPreferences.entertainment.map(e => e.item).join(', ')}\n`;
    }
    if (profile.topPreferences.activities?.length > 0) {
      prompt += `- Activities: ${profile.topPreferences.activities.map(a => a.item).join(', ')}\n`;
    }
  }

  // Add communication style
  if (profile.communicationStyle) {
    prompt += '\n## Communication Style:\n';
    if (profile.communicationStyle.tone?.primary) {
      prompt += `- Tone: ${profile.communicationStyle.tone.primary}\n`;
    }
    if (profile.communicationStyle.responseStyle?.averageLength) {
      prompt += `- Response length: ${profile.communicationStyle.responseStyle.averageLength}\n`;
    }
    if (profile.communicationStyle.vocabulary?.uniquePhrases?.length > 0) {
      prompt += `- Unique phrases: "${profile.communicationStyle.vocabulary.uniquePhrases.slice(0, 5).join('", "')}"\n`;
    }
  }

  // Add relationships
  if (profile.relationships?.length > 0) {
    prompt += '\n## Important People:\n';
    profile.relationships.slice(0, 5).forEach(r => {
      prompt += `- ${r.name} (${r.relationship})\n`;
    });
  }

  // Add past context
  if (pastContext) {
    prompt += `\n## Relevant Past Conversations:\n${pastContext}\n`;
  }

  prompt += `
## Instructions:
1. Respond naturally as this person would
2. Match their communication style and tone
3. Reference their preferences and knowledge when relevant
4. Use their vocabulary and phrases
5. Be consistent with their personality
6. If asked about something not in their profile, respond as they reasonably would based on their personality
7. Never break character or mention you're an AI

Respond now as this person:`;

  return prompt;
}

/**
 * Generate questions to fill profile gaps
 * @param {string} userId - User ID
 * @returns {Promise<string[]>} - Questions to ask
 */
async function generateProfileQuestions(userId) {
  try {
    const profile = await Profile.getOrCreate(userId);
    const gaps = profile.quality.needsMoreInfo || [];
    
    if (gaps.length === 0 && profile.quality.completeness > 80) {
      return [];
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: `You are a friendly AI assistant helping to learn more about a user to build their digital profile.
          
Generate 2-3 natural, conversational questions to learn more about the user.
Focus on these gaps: ${gaps.join(', ')}

Profile completeness: ${profile.quality.completeness}%

Make questions friendly and not intrusive. Vary between personal preferences, daily life, and background.`
        },
        {
          role: 'user',
          content: 'Generate questions to learn more about me.'
        }
      ],
      temperature: 0.8,
      max_tokens: 300
    });

    // Parse questions from response
    const questions = response.choices[0].message.content
      .split('\n')
      .filter(line => line.trim().endsWith('?'))
      .map(q => q.replace(/^\d+\.\s*/, '').trim());

    return questions.slice(0, 3);
  } catch (error) {
    console.error('Error generating questions:', error);
    return ['Tell me about yourself.'];
  }
}

/**
 * Update profile based on transcript analysis
 * @param {string} userId - User ID
 * @param {Object} analysis - Transcript analysis result
 * @param {string} rawText - Original transcript
 */
async function updateProfileFromAnalysis(userId, analysis, rawText) {
  try {
    const profile = await Profile.getOrCreate(userId);
    
    // Update preferences
    if (analysis.preferences) {
      for (const pref of analysis.preferences) {
        if (pref.category && pref.item) {
          const embedding = await generateEmbedding(`${pref.category}: ${pref.item}`);
          await profile.addPreference(
            pref.category,
            pref.item,
            pref.sentiment || 'likes',
            rawText.substring(0, 200),
            embedding
          );
        }
      }
    }
    
    // Update relationships
    if (analysis.relationships) {
      for (const rel of analysis.relationships) {
        if (rel.name) {
          await profile.updateRelationship(
            rel.name,
            rel.relationship || 'mentioned',
            rawText.substring(0, 200),
            rel.sentiment || 'neutral'
          );
        }
      }
    }
    
    // Update basic info
    if (analysis.facts) {
      if (analysis.facts.occupation && !profile.basicInfo.occupation) {
        profile.basicInfo.occupation = analysis.facts.occupation;
      }
      if (analysis.facts.location && !profile.basicInfo.location) {
        profile.basicInfo.location = analysis.facts.location;
      }
      if (analysis.facts.name && !profile.basicInfo.displayName) {
        profile.basicInfo.displayName = analysis.facts.name;
      }
    }
    
    // Update knowledge areas
    if (analysis.topics) {
      for (const topic of analysis.topics) {
        const existing = profile.knowledgeAreas.find(k => 
          k.topic.toLowerCase() === topic.toLowerCase()
        );
        
        if (existing) {
          existing.mentions += 1;
          existing.lastDiscussed = new Date();
        } else {
          const embedding = await generateEmbedding(topic);
          profile.knowledgeAreas.push({
            topic,
            expertise: 'mentioned',
            mentions: 1,
            relatedTopics: [],
            embedding,
            lastDiscussed: new Date()
          });
        }
      }
    }
    
    // Update goals
    if (analysis.goals) {
      for (const goal of analysis.goals) {
        const embedding = await generateEmbedding(goal.description || goal);
        profile.goalsAndAspirations.push({
          goal: goal.description || goal,
          category: goal.category || 'general',
          status: 'mentioned',
          context: rawText.substring(0, 200),
          embedding,
          mentionedAt: new Date()
        });
      }
    }
    
    // Recalculate completeness
    profile.quality.dataPoints += 1;
    profile.calculateCompleteness();
    
    await profile.save();
    
    return profile;
  } catch (error) {
    console.error('Error updating profile:', error);
    throw error;
  }
}

/**
 * Detect if the transcript contains a question for the AI
 * @param {string} text - Transcript text
 * @returns {Promise<Object>} - Detection result
 */
async function detectQuestion(text) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `Analyze if the text is a question or request directed at an AI assistant.
Return JSON with:
- isQuestion: boolean
- requiresResponse: boolean (does this need a reply?)
- intent: string (question, command, statement, unclear)
- summary: brief summary of what's being asked`
        },
        {
          role: 'user',
          content: text
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 200
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('Error detecting question:', error);
    return { isQuestion: false, requiresResponse: false, intent: 'unclear' };
  }
}

module.exports = {
  analyzeTranscript,
  generateCloneResponse,
  generateProfileQuestions,
  updateProfileFromAnalysis,
  detectQuestion
};

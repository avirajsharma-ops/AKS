/**
 * Embedding Service
 * Generates vector embeddings using OpenAI's text-embedding model
 */

const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Cache for recent embeddings to reduce API calls
const embeddingCache = new Map();
const CACHE_SIZE = 1000;

/**
 * Generate embedding for a single text
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} - 1536-dimensional embedding vector
 */
async function generateEmbedding(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('Text is required for embedding generation');
  }
  
  // Check cache
  const cacheKey = text.substring(0, 100); // Use first 100 chars as key
  if (embeddingCache.has(cacheKey)) {
    return embeddingCache.get(cacheKey);
  }
  
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: text.trim(),
    });
    
    const embedding = response.data[0].embedding;
    
    // Update cache
    if (embeddingCache.size >= CACHE_SIZE) {
      // Remove oldest entry
      const firstKey = embeddingCache.keys().next().value;
      embeddingCache.delete(firstKey);
    }
    embeddingCache.set(cacheKey, embedding);
    
    return embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw error;
  }
}

/**
 * Generate embeddings for multiple texts (batch)
 * @param {string[]} texts - Array of texts to embed
 * @returns {Promise<number[][]>} - Array of embedding vectors
 */
async function generateEmbeddings(texts) {
  if (!texts || texts.length === 0) {
    throw new Error('Texts array is required');
  }
  
  // Filter out empty texts
  const validTexts = texts.filter(t => t && t.trim().length > 0);
  
  if (validTexts.length === 0) {
    return [];
  }
  
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: validTexts.map(t => t.trim()),
    });
    
    return response.data.map(d => d.embedding);
  } catch (error) {
    console.error('Error generating batch embeddings:', error);
    throw error;
  }
}

/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} vecA - First vector
 * @param {number[]} vecB - Second vector
 * @returns {number} - Similarity score (0-1)
 */
function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have the same length');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Find most similar texts from a list
 * @param {string} query - Query text
 * @param {Array<{text: string, embedding: number[]}>} documents - Documents with embeddings
 * @param {number} topK - Number of results to return
 * @returns {Promise<Array<{text: string, similarity: number}>>}
 */
async function findSimilar(query, documents, topK = 5) {
  const queryEmbedding = await generateEmbedding(query);
  
  const similarities = documents.map(doc => ({
    ...doc,
    similarity: cosineSimilarity(queryEmbedding, doc.embedding)
  }));
  
  // Sort by similarity descending
  similarities.sort((a, b) => b.similarity - a.similarity);
  
  return similarities.slice(0, topK);
}

/**
 * Create a combined profile embedding from multiple aspects
 * @param {Object} profileData - User profile data
 * @returns {Promise<number[]>} - Combined profile embedding
 */
async function createProfileEmbedding(profileData) {
  // Create a text summary of the profile
  const summaryParts = [];
  
  if (profileData.basicInfo?.occupation) {
    summaryParts.push(`Occupation: ${profileData.basicInfo.occupation}`);
  }
  
  if (profileData.preferences?.food?.length > 0) {
    const foods = profileData.preferences.food.slice(0, 5).map(f => f.item).join(', ');
    summaryParts.push(`Food preferences: ${foods}`);
  }
  
  if (profileData.preferences?.activities?.length > 0) {
    const activities = profileData.preferences.activities.slice(0, 5).map(a => a.item).join(', ');
    summaryParts.push(`Activities: ${activities}`);
  }
  
  if (profileData.knowledgeAreas?.length > 0) {
    const knowledge = profileData.knowledgeAreas.slice(0, 5).map(k => k.topic).join(', ');
    summaryParts.push(`Knowledge areas: ${knowledge}`);
  }
  
  if (profileData.communicationStyle?.tone?.primary) {
    summaryParts.push(`Communication style: ${profileData.communicationStyle.tone.primary}`);
  }
  
  const summary = summaryParts.join('. ');
  
  if (summary.length === 0) {
    // Return zero vector if no profile data
    return new Array(1536).fill(0);
  }
  
  return generateEmbedding(summary);
}

module.exports = {
  generateEmbedding,
  generateEmbeddings,
  cosineSimilarity,
  findSimilar,
  createProfileEmbedding
};

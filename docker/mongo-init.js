// MongoDB initialization script
// Creates the database and user with appropriate permissions

db = db.getSiblingDB('aks');

// Create collections
db.createCollection('users');
db.createCollection('transcripts');
db.createCollection('profiles');

// Create indexes for better query performance
db.users.createIndex({ email: 1 }, { unique: true });
db.transcripts.createIndex({ userId: 1, createdAt: -1 });
db.transcripts.createIndex({ userId: 1, 'analysis.topics': 1 });
db.profiles.createIndex({ userId: 1 }, { unique: true });

// Note: Vector Search index must be created via MongoDB Atlas UI or Atlas CLI
// The following is a placeholder showing the expected index configuration:
// 
// Vector Search Index for 'transcripts' collection:
// {
//   "name": "vector_index",
//   "type": "vectorSearch",
//   "definition": {
//     "fields": [
//       {
//         "type": "vector",
//         "path": "embedding",
//         "numDimensions": 1536,
//         "similarity": "cosine"
//       }
//     ]
//   }
// }

print('AKS database initialized successfully!');

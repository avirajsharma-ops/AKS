/**
 * AKS Backend Server
 * Main entry point for the AI Knowledge System
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoose = require('mongoose');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const transcriptRoutes = require('./routes/transcript');
const profileRoutes = require('./routes/profile');
const speechRoutes = require('./routes/speech');

// Import WebSocket handler
const { initializeWebSocket } = require('./services/websocket');

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');
const { rateLimiter } = require('./middleware/rateLimiter');

const app = express();
const server = http.createServer(app);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: [
    process.env.FRONTEND_WEB_URL || 'http://localhost:3000',
    process.env.FRONTEND_WEB_URL || 'http://localhost:3000'
  ],
  credentials: true
}));

// Request parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Rate limiting
app.use(rateLimiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'AKS Backend'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/transcripts', transcriptRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/speech', speechRoutes);

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Database connection
const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
};

// Initialize WebSocket server
initializeWebSocket(server);

// Start server
const PORT = process.env.PORT || 5001;

const startServer = async () => {
  await connectDB();
  
  server.listen(PORT, () => {
    console.log(`
    ╔═══════════════════════════════════════════╗
    ║          AKS Backend Server               ║
    ╠═══════════════════════════════════════════╣
    ║  🚀 Server running on port ${PORT}           ║
    ║  📦 Environment: ${process.env.NODE_ENV || 'development'}        ║
    ║  🔗 WebSocket enabled                     ║
    ╚═══════════════════════════════════════════╝
    `);
  });
};

startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    mongoose.connection.close(false, () => {
      console.log('Server closed. Database disconnected.');
      process.exit(0);
    });
  });
});

module.exports = { app, server };

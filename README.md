# AKS - AI Knowledge System (Digital Clone)

> "AKS" means "clone" in Urdu. This system creates a personalized AI agent that learns from and mimics you.

## 🎯 Overview

AKS is a privacy-first AI agent that:
- Continuously monitors and transcribes your speech (with explicit permission)
- Learns your patterns, preferences, and communication style
- Acts as your digital clone, responding as you would
- Provides a speech-first interface with always-on listening capability

## 📁 Project Structure

```
aks-project/
├── backend/                # Node.js/Express server
│   ├── models/            # Mongoose schemas
│   ├── routes/            # API endpoints
│   ├── services/          # Business logic (AI, TTS, STT)
│   ├── middleware/        # Auth, validation
│   └── utils/             # Helpers
├── frontend-web/          # React PWA (mobile-first)
├── docker/                # Docker configuration
└── docs/                  # Documentation
```

## 🚀 Quick Start

### Prerequisites
- Node.js v18+
- Docker & Docker Compose
- MongoDB Atlas account
- API Keys:
  - Deepgram (speech recognition)
  - ElevenLabs (text-to-speech)
  - OpenAI (embeddings & AI)

### Installation

1. **Clone the repository:**
   ```bash
   git clone <repo-url>
   cd aks-project
   ```

2. **Setup Backend:**
   ```bash
   cd backend
   npm install
   cp .env.example .env
   # Edit .env with your API keys
   npm run dev
   ```

3. **Setup Web Frontend:**
   ```bash
   cd frontend-web
   npm install
   npm start
   ```

4. **Run with Docker:**
   ```bash
   docker-compose up --build
   ```

## 🔐 Privacy & Permissions

- Background listening is **opt-in only**
- Users can revoke permissions anytime
- All data is encrypted and user-isolated
- Clear data collection disclosure on registration

## 📱 Web Support

- **Web:** Progressive Web App (PWA) with service workers for background support
- Works on desktop and mobile browsers

## 🛠 Tech Stack

- **Backend:** Node.js, Express, WebSocket
- **Database:** MongoDB Atlas with Vector Search
- **Frontend:** React PWA
- **Speech Recognition:** Native Web Speech API (Hindi + English)
- **Text-to-Speech:** ElevenLabs (multilingual)
- **AI/Embeddings:** OpenAI, LangChain
- **Deployment:** Docker
## 🔧 API Endpoints

### Authentication
- `POST /api/auth/register` - Create new account
- `POST /api/auth/login` - Login and get tokens
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout and invalidate token

### User
- `GET /api/user/me` - Get current user
- `PUT /api/user/permissions` - Update privacy permissions
- `DELETE /api/user/data` - Delete all user data

### Transcripts
- `GET /api/transcripts` - List transcripts (paginated)
- `GET /api/transcripts/:id` - Get single transcript
- `GET /api/transcripts/search` - Semantic search
- `DELETE /api/transcripts/:id` - Delete transcript

### Profile
- `GET /api/profile` - Get AI profile
- `PUT /api/profile` - Update profile

### Speech
- `GET /api/speech/voices` - List available TTS voices
- `POST /api/speech/synthesize` - Text-to-speech

### WebSocket
- `ws://localhost:5001/ws/audio` - Real-time audio streaming

## 🐳 Docker Deployment

```bash
# Copy environment template
cp .env.example .env

# Edit with your API keys
nano .env

# Build and start services
docker-compose up -d --build

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

Access the application:
- Frontend: http://localhost:3000
- Backend API: http://localhost:5001

## 🧪 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `MONGODB_URI` | MongoDB connection string | Yes |
| `JWT_SECRET` | JWT signing secret | Yes |
| `JWT_REFRESH_SECRET` | Refresh token secret | Yes |
| `OPENAI_API_KEY` | OpenAI API key | Yes |
| `DEEPGRAM_API_KEY` | Deepgram API key | Yes |
| `ELEVENLABS_API_KEY` | ElevenLabs API key | No |
## 📄 License

MIT License - See LICENSE file

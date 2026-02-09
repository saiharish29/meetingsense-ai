<div align="center">

# 🎯 MeetingSense AI

**Intelligent Meeting Analysis Engine — Self-Hosted & Open Source**

Convert meeting recordings and transcripts into structured summaries, decisions, action items, and clean transcripts using Google Gemini AI.

![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-sql.js-003B57?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

</div>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🎙️ **Dual-Channel Live Recording** | Records your mic (host) and system audio (participants) on separate channels for accurate speaker identification |
| 🎧 **Smart Speaker Separation** | Stereo recording: left channel = host, right channel = other participants. Gemini uses this for reliable speaker tagging |
| 📁 **Audio/Video Upload** | Upload pre-recorded MP3, WAV, WebM, MP4, MOV files (up to 500MB) |
| 📝 **Text Transcript Analysis** | Paste meeting transcripts or notes for instant structured analysis |
| 🧠 **AI-Powered Intelligence** | Powered by Google Gemini 2.5 Flash for accurate extraction of decisions, action items, and risks |
| 💾 **Persistent Storage** | SQLite database stores all meetings, results, and uploaded files permanently |
| 🔍 **Search & Filter** | Full-text search across meeting titles and summaries with status filtering |
| 📊 **Dashboard** | Overview statistics, recent meetings, and quick navigation |
| 📤 **Export** | Download analysis results as Markdown files |
| 🔐 **API Key Management** | Configure API key on first launch via UI — stored securely in local database |
| 👥 **Participant Photos** | Upload participant images to assist with speaker identification |
| 📱 **Responsive UI** | Clean, modern interface built with React and Tailwind CSS |

## 🎙️ Advanced Speaker Identification System

The biggest challenge in meeting transcription is **correctly identifying who said what**. MeetingSense AI solves this with a **5-signal identification system** that goes far beyond what a single audio stream can provide.

### The Problem
- Single-stream recording mixes all voices together — AI has to guess who is speaking
- Random screenshots are unreliable for speaker identification
- Voice-only identification fails when participants have similar accents or speaking styles
- The host's voice gets confused with participants in mixed audio

### The Solution: Multi-Signal Speaker Identification

```
┌─────────────── 5 IDENTIFICATION SIGNALS ───────────────┐
│                                                         │
│  Signal 1: STEREO CHANNEL SEPARATION (Hardware-level)   │
│  ┌──────────┐              ┌──────────────────┐        │
│  │ Your Mic │ → Left Ch    │ System Audio     │→ Right │
│  │ (Host)   │              │ (Participants)   │   Ch   │
│  └──────────┘              └──────────────────┘        │
│  100% reliable: Left = Host, Right = Everyone else      │
│                                                         │
│  Signal 2: SPEAKER ACTIVITY TIMELINE                    │
│  Energy detection every 200ms on both channels:         │
│  [00:00-00:15] Host speaking ████████░░░░░             │
│  [00:12-00:30] Participants  ░░░░████████████          │
│  [00:28-00:45] Host speaking ░░░░░░░░████████          │
│                                                         │
│  Signal 3: PERIODIC SCREENSHOTS (every 30 seconds)      │
│  Meeting apps highlight the active speaker — Gemini     │
│  reads name labels and speaker indicators from these    │
│  screenshots and maps them to the audio timeline.       │
│                                                         │
│  Signal 4: PARTICIPANT ROSTER                           │
│  Names entered before recording → used instead of       │
│  generic "Speaker B/C" labels                           │
│                                                         │
│  Signal 5: VOICE CONSISTENCY TRACKING                   │
│  Once a voice is matched to a name (via screenshots),   │
│  that assignment is maintained throughout.               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### How Signals Work Together (Example)

1. **At 02:15**, the system captures a screenshot from Zoom showing "Sarah Chen" highlighted as active speaker
2. **At 02:15**, the speaker activity timeline shows the RIGHT channel (participants) is active
3. **Therefore**: The voice on the right channel at 02:15 belongs to Sarah Chen
4. **Voice tracking**: The AI notes Sarah's voice characteristics and matches them to other segments
5. **At 05:30**, the same voice speaks again → automatically tagged as Sarah Chen
6. **Meanwhile**: Any audio on the LEFT channel is always tagged as the host (e.g., Harish)

### Recording Flow

1. Enter your name and add other participants' names
2. Click **Start Recording** → microphone captures your voice (left channel)
3. Share your meeting screen → captures participants' audio (right channel) AND video for screenshots
4. System automatically captures screenshots every 30 seconds and builds a speech timeline
5. Click **Stop & Analyze** → all signals are packaged and sent to Gemini with structured metadata

### What Gets Sent to Gemini

| Data | Purpose |
|------|---------|
| Merged stereo audio (WebM) | Left = host, Right = participants |
| Speaker activity timeline | Timestamped speech segments per channel |
| Screenshots (JPEG, every 30s) | Visual evidence of active speaker |
| Participant roster | Name mapping |
| Channel layout metadata | Instructions for the AI |

### Output: Speaker Identification Summary

Every analysis includes a transparency section showing how each speaker was identified:

| Speaker | Identification Method | Confidence |
|---------|----------------------|------------|
| Harish  | Host mic (left channel) | High |
| Sarah   | Screenshot at 02:15 + voice match | Medium |
| Speaker C | Voice differentiation only | Low |

## 📦 Prerequisites

- **Node.js** 18+ (recommended: 22+)
- **Google Gemini API Key** — free tier available at [Google AI Studio](https://aistudio.google.com/apikey)

## 🚀 Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/meetingsense-ai.git
cd meetingsense-ai
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start in development mode

```bash
npm run dev
```

This starts both:
- **Backend API** on `http://localhost:3001`
- **Frontend dev server** on `http://localhost:3000` (with hot reload)

### 4. Configure API Key

On first launch, the app will prompt you to enter your Google Gemini API key. The key is stored in the local SQLite database and never transmitted anywhere except to Google's API.

Alternatively, create `.env.local` with:

```bash
GEMINI_API_KEY=your_api_key_here
PORT=3001
UPLOAD_DIR=./uploads
MAX_FILE_SIZE_MB=500
```

## 🏭 Production Deployment

### Build and run

```bash
npm run build       # Build React frontend
npm start           # Start Express server (serves built frontend)
```

The production server runs on port 3001 by default and serves both the API and the static frontend.

### Docker (optional)

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GEMINI_API_KEY` | *(empty)* | Google Gemini API key (or configure via UI) |
| `PORT` | `3001` | Server port |
| `UPLOAD_DIR` | `./uploads` | Directory for uploaded audio/video files |
| `MAX_FILE_SIZE_MB` | `500` | Maximum upload file size in MB |

## 📁 Project Structure

```
meetingsense-ai/
├── server/                  # Express backend
│   ├── index.js            # Server entry point
│   ├── db/
│   │   └── database.js     # SQLite (sql.js) initialization & helpers
│   └── routes/
│       ├── meetings.js     # Meeting CRUD, upload, export endpoints
│       └── settings.js     # API key management endpoints
├── src/                     # React frontend
│   ├── main.tsx            # React entry point
│   ├── App.tsx             # Main app with routing & API key gate
│   ├── components/
│   │   ├── ApiKeySetup.tsx # First-run API key configuration
│   │   ├── Dashboard.tsx   # Dashboard with stats & recent meetings
│   │   ├── InputSection.tsx    # 3-mode input: Live Record, Upload, Text
│   │   ├── Layout.tsx      # Sidebar navigation layout
│   │   ├── MeetingDetailView.tsx # Single meeting view
│   │   ├── MeetingHistory.tsx   # Paginated meeting list
│   │   ├── ProcessingState.tsx  # Analysis progress indicator
│   │   └── ResultView.tsx  # Tabbed analysis result display
│   ├── hooks/
│   │   └── useMeetingRecorder.ts # Dual-channel recording hook (mic + system audio)
│   ├── services/
│   │   ├── api.ts          # Backend REST API client
│   │   └── geminiService.ts # Gemini AI integration
│   ├── constants.ts        # System prompt & config
│   └── types.ts            # TypeScript interfaces
├── uploads/                 # Uploaded files (git-ignored)
├── index.html              # HTML entry with Tailwind config
├── vite.config.ts          # Vite configuration with API proxy
├── tsconfig.json           # TypeScript configuration
├── package.json            # Dependencies & scripts
├── .env.local              # Environment variables (git-ignored)
└── .gitignore
```

## 🔌 API Reference

### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/settings/api-key/status` | Check if API key is configured |
| `POST` | `/api/settings/api-key` | Save API key `{ apiKey: "..." }` |
| `POST` | `/api/settings/api-key/validate` | Validate an API key |
| `GET` | `/api/settings/api-key/active` | Get the active API key |

### Meetings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/meetings` | List meetings (supports `?page=&limit=&search=&status=`) |
| `GET` | `/api/meetings/stats/overview` | Dashboard statistics |
| `GET` | `/api/meetings/:id` | Get meeting with full details |
| `POST` | `/api/meetings` | Create meeting (multipart: `file`, `text`, `participantImgs`) |
| `PUT` | `/api/meetings/:id/result` | Save analysis result |
| `PUT` | `/api/meetings/:id/status` | Update meeting status |
| `DELETE` | `/api/meetings/:id` | Delete meeting and associated files |
| `GET` | `/api/meetings/:id/export` | Export result as Markdown file |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Server & database health check |

## 🗄️ Database Schema

The SQLite database (`server/db/meetingsense.db`) contains:

- **meetings** — Core meeting records with title, status, duration, timestamps
- **meeting_inputs** — Input data (text transcripts, file references)
- **meeting_results** — AI analysis results (raw markdown, executive summary, metadata JSON)
- **meeting_participants** — Participant names and optional photo references
- **app_settings** — Application settings including API key storage

Reset the database:
```bash
npm run db:reset
```

## 🔒 Security Notes

- API keys are stored in the local SQLite database file, **not** in plain text config files
- The database file is `.gitignored` and should never be committed
- Uploaded files are stored locally — ensure appropriate filesystem permissions
- In production, consider adding authentication middleware and HTTPS

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📄 License

This project is open source under the [MIT License](LICENSE).

## 🙏 Acknowledgements

- [Google Gemini AI](https://ai.google.dev/) — AI processing engine
- [sql.js](https://github.com/sql-js/sql.js/) — SQLite in JavaScript (no native deps)
- [Express](https://expressjs.com/) — Backend framework
- [React](https://react.dev/) — Frontend framework
- [Vite](https://vitejs.dev/) — Build tool
- [Tailwind CSS](https://tailwindcss.com/) — Styling
"# meetingsense-ai" 

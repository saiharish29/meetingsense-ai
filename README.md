<div align="center">

# 🎯 MeetingSense AI

**Intelligent Meeting Analysis Engine — Self-Hosted, Open Source, Bring Your Own Key**

Convert meeting recordings and transcripts into structured summaries, decisions, action items, and clean speaker-tagged transcripts — powered by Google Gemini AI running entirely on your machine.

![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-sql.js-003B57?logo=sqlite&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini-2.5%20Flash-4285F4?logo=google&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

</div>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🎙️ **Dual-Channel Live Recording** | Records your mic (host) and system audio (participants) on separate stereo channels for accurate speaker identification |
| 🔑 **Bring Your Own Key (BYOK)** | Enter your Gemini API key on first launch — stored locally, never shared. Choose from any model on your account |
| 🤖 **Model Selection** | Pick any Gemini model available on your API key (2.5 Flash, 2.5 Pro, 2.0 Flash, 1.5 Pro, etc.) |
| 🖥️ **Server-Side Analysis** | All Gemini API calls run in Node.js — no browser timeouts, full retry logic, handles 1.5h+ recordings reliably |
| 📡 **Real-Time Progress** | Server-Sent Events stream analysis progress live to your browser during long recordings |
| 🧠 **5-Signal Speaker ID** | Stereo channels + speech timeline + screenshots + participant roster + voice tracking |
| 📁 **Audio/Video Upload** | Upload pre-recorded MP3, WAV, WebM, MP4, MOV files (up to 500 MB) |
| 📝 **Text Transcript Analysis** | Paste meeting transcripts or notes for instant structured analysis |
| 💾 **Persistent Storage** | SQLite database stores all meetings, results, and uploaded files permanently |
| 🔍 **Search & Filter** | Full-text search across meeting titles and summaries with status filtering |
| 📊 **Dashboard** | Overview statistics, recent meetings, and quick navigation |
| 📤 **Export** | Download analysis results as Markdown files |
| 👥 **Participant Photos** | Upload participant images to assist with speaker identification |

---

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
6. **Meanwhile**: Any audio on the LEFT channel is always tagged as the host

### What Gets Sent to Gemini

All data is uploaded to **your own server** first, then analyzed by Gemini from Node.js (never directly from the browser).

| Data | Purpose |
|------|---------|
| Merged stereo audio (WebM) | Left = host, Right = participants |
| Speaker activity timeline | Timestamped speech segments per channel |
| Up to 40 screenshots (JPEG, every 30s) | Visual evidence of active speaker |
| Participant roster | Name mapping for speaker identification |
| Channel layout metadata | Instructions for the AI |

### Output: Speaker Identification Summary

Every analysis includes a transparency section showing how each speaker was identified:

| Speaker | Identification Method | Confidence |
|---------|----------------------|------------|
| Harish  | Host mic (left channel) | High |
| Sarah   | Screenshot at 02:15 + voice match | Medium |
| Speaker C | Voice differentiation only | Low |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        BROWSER                              │
│                                                             │
│  • Live recording (getUserMedia + getDisplayMedia)          │
│  • Audio channel merge (Web Audio API)                      │
│  • Screenshot capture every 30s                             │
│  • Upload audio + screenshots → backend                     │
│  • Streams SSE progress events from backend to UI           │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP / SSE
┌──────────────────────────▼──────────────────────────────────┐
│                    NODE.JS SERVER (3001)                     │
│                                                             │
│  Express API                                                │
│  ├─ POST /api/meetings          — store recording + files   │
│  ├─ POST /api/meetings/:id/analyze  — trigger analysis      │
│  │   └─ streams SSE events while running                    │
│  ├─ GET  /api/settings/models   — list Gemini models        │
│  └─ POST /api/settings/model    — save model preference     │
│                                                             │
│  geminiAnalyzer.js                                          │
│  ├─ Reads audio + images from disk                          │
│  ├─ Uploads audio via File API (with 3× retry)              │
│  ├─ Calls generateContent with selected model               │
│  ├─ Fallback: full → 50% images → audio only                │
│  └─ Emits progress events throughout                        │
│                                                             │
│  SQLite (sql.js) — meetingsense.db                          │
│  └─ meetings, inputs, results, participants, settings       │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS
┌──────────────────────────▼──────────────────────────────────┐
│              GOOGLE GEMINI API (your key)                   │
│                                                             │
│  • File API — stores large audio files (up to 2 GB)         │
│  • generateContent — multi-modal analysis                   │
│    (audio + screenshots + text prompt)                      │
│  • Supported recording length: up to 9.5 hours              │
└─────────────────────────────────────────────────────────────┘
```

### Why Analysis Runs Server-Side

Previously, Gemini was called directly from the browser. This caused failures for long recordings because:

- A 1.5-hour recording produces ~86 MB of audio — analysis takes 5–8+ minutes
- Browser fetch requests time out long before Gemini finishes
- No retry logic existed; failures were silent

**Now, Node.js handles everything:**
- Server-side processing with no internal timeout — runs until Gemini responds
- 25-minute client safety valve covers even the largest supported recordings (see [Long Meeting Support](#️-long-meeting-support))
- 3-attempt retry with exponential backoff on every API call
- SSE keepalive every 25 seconds prevents proxy timeouts
- Fallback strategy: if the full payload is too large, automatically reduces image count and retries

---

## 📦 Prerequisites

- **Node.js** 18 or higher (22+ recommended)
- **Google Gemini API Key** — free tier available at [Google AI Studio](https://aistudio.google.com/apikey)
- A modern browser (Chrome or Edge recommended for screen-capture APIs)

---

## 🚀 Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/saiharish29/meetingsense-ai.git
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

### 4. First-run setup (two steps)

On first launch the app walks you through a quick setup:

**Step 1 — API Key**
Enter your Google Gemini API key. It is validated immediately and stored in the local SQLite database — never transmitted anywhere except to Google's API.

**Step 2 — Model Selection**
After validation, the app fetches all Gemini models available on your account and shows them in a dropdown. Recommended audio-capable models are listed first. Your choice is saved and used for every analysis.

> You can change either setting any time via the ⚙️ Settings button in the sidebar.

#### Alternative: environment file

Create `.env.local` in the project root to pre-configure the API key (model can still be selected via UI):

```env
GEMINI_API_KEY=your_api_key_here
PORT=3001
UPLOAD_DIR=./uploads
MAX_FILE_SIZE_MB=500
```

---

## 🎬 Recording a Meeting (Live Mode)

1. Open the app → click **New Meeting**
2. Enter your name and the names of other participants
3. Click **Start Recording**
   - Browser requests microphone access (your voice → left channel)
   - Browser requests screen share — **select your meeting window** and enable "Share system audio" (participants → right channel)
4. The recording indicator shows live channel levels and screenshot count
5. When the meeting ends, click **Stop & Analyze**
6. The app uploads the recording to your local server, then streams real-time progress as Gemini processes it

> **Tip:** For the best speaker identification, share the actual meeting app window (Zoom, Teams, Meet) so the 30-second screenshots capture the highlighted active-speaker UI.

---

## 🏭 Production Deployment

### Build and run

```bash
npm run build    # Compiles React frontend to dist/
npm start        # Starts Express (serves API + built frontend on one port)
```

The production server runs on port `3001` by default and serves both the REST API and the compiled frontend as static files.

### Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GEMINI_API_KEY` | *(empty)* | Pre-configure API key (or set via UI on first launch) |
| `PORT` | `3001` | Server port |
| `UPLOAD_DIR` | `./uploads` | Directory for uploaded audio/video/image files |
| `MAX_FILE_SIZE_MB` | `500` | Maximum single-file upload size in MB |

---

## 📁 Project Structure

```
meetingsense-ai/
├── server/                          # Express backend (Node.js)
│   ├── index.js                     # Server entry point — port 3001
│   ├── constants.js                 # SYSTEM_PROMPT + model list
│   ├── db/
│   │   └── database.js              # SQLite (sql.js) helpers
│   ├── services/
│   │   └── geminiAnalyzer.js        # ★ Server-side Gemini engine
│   │                                #   (File API upload, retry, SSE events)
│   ├── routes/
│   │   ├── meetings.js              # CRUD + POST /:id/analyze (SSE)
│   │   └── settings.js              # API key + model management
│   └── __tests__/
│       └── sseHelpers.test.js       # Server SSE helper unit tests
│
├── src/                             # React 19 + TypeScript frontend
│   ├── App.tsx                      # Routing, analysis orchestration
│   ├── constants.ts                 # Frontend constants
│   ├── types.ts                     # TypeScript interfaces
│   ├── components/
│   │   ├── ApiKeySetup.tsx          # Two-step first-run setup
│   │   ├── ModelSelector.tsx        # ★ Gemini model picker dropdown
│   │   ├── Dashboard.tsx            # Stats + recent meetings
│   │   ├── InputSection.tsx         # Live record / Upload / Paste text
│   │   ├── Layout.tsx               # Sidebar navigation
│   │   ├── MeetingDetailView.tsx    # Single meeting detail
│   │   ├── MeetingHistory.tsx       # Paginated meeting list
│   │   ├── ProcessingState.tsx      # Live SSE progress display
│   │   └── ResultView.tsx           # Tabbed analysis results
│   ├── hooks/
│   │   └── useMeetingRecorder.ts    # Dual-channel recording (mic + system audio)
│   ├── services/
│   │   ├── api.ts                   # REST + SSE client (analyzeWithServer)
│   │   └── geminiService.ts         # Thin delegate to backend
│   └── __tests__/
│       ├── setup.ts                 # Vitest setup (jest-dom matchers)
│       ├── analyzeWithServer.test.ts # API client regression + unit tests
│       ├── AppTimeoutError.test.tsx  # App error-handling regression tests
│       └── InputSection.test.tsx    # InputSection component tests
│
├── uploads/                         # Stored recordings & images (git-ignored)
├── index.html
├── vite.config.ts                   # Dev proxy: /api → :3001
├── vitest.config.ts                 # Test runner configuration
├── tsconfig.json
├── package.json
└── .env.local                       # Optional env overrides (git-ignored)
```

---

## 🔌 API Reference

### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/settings/api-key/status`   | Check if API key is configured; returns active model |
| `POST` | `/api/settings/api-key`          | Save API key `{ apiKey }` |
| `POST` | `/api/settings/api-key/validate` | Validate an API key against Gemini |
| `GET`  | `/api/settings/api-key/active`   | Return the active API key |
| `GET`  | `/api/settings/models`           | List all Gemini models on the account (sorted, annotated) |
| `POST` | `/api/settings/model`            | Save model preference `{ model }` |
| `GET`  | `/api/settings/model`            | Return currently selected model |

### Meetings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`    | `/api/meetings`                   | List meetings (`?page=&limit=&search=&status=`) |
| `GET`    | `/api/meetings/stats/overview`    | Dashboard statistics |
| `GET`    | `/api/meetings/:id`               | Get meeting with inputs, result, participants |
| `POST`   | `/api/meetings`                   | Create meeting (multipart: `file`, `text`, `participantImgs`) |
| `POST`   | `/api/meetings/:id/analyze`       | ★ Trigger server-side Gemini analysis — **streams SSE** |
| `PUT`    | `/api/meetings/:id/result`        | Manually save an analysis result |
| `PUT`    | `/api/meetings/:id/status`        | Update meeting status |
| `DELETE` | `/api/meetings/:id`               | Delete meeting and all associated files |
| `GET`    | `/api/meetings/:id/export`        | Download result as `.md` file |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Server and database health check |

---

## 🗄️ Database Schema

The SQLite database lives at `server/db/meetingsense.db` and is auto-saved every 30 seconds.

| Table | Description |
|-------|-------------|
| `meetings` | Core records — id, title, status, duration, timestamps |
| `meeting_inputs` | Text content and file references (audio, video, image) |
| `meeting_results` | Raw markdown, executive summary, metadata JSON |
| `meeting_participants` | Participant names and optional photo paths |
| `app_settings` | API key, selected Gemini model, other preferences |

Reset the database (deletes all data):

```bash
npm run db:reset
```

---

## ⏱️ Long Meeting Support

MeetingSense AI is tested and designed for recordings up to **1.5 hours** (and beyond, up to Gemini's 9.5-hour audio limit).

| Recording length | Audio size (approx) | Upload method | Typical analysis time |
|-----------------|---------------------|--------------|----------------------|
| < 10 min | < 15 MB | Inline base64 | 1–2 min |
| 10–30 min | 15–43 MB | Gemini File API | 2–4 min |
| 30–90 min | 43–130 MB | Gemini File API | 4–8 min |
| 90 min–9.5 h | 130 MB–2 GB | Gemini File API | 8–20 min |

### Automatic Fallback Chain

If the full payload exceeds Gemini's context limit, the server automatically retries with a smaller payload:

```
Attempt 1: audio + 40 screenshots + full metadata
    ↓ (if token limit error)
Attempt 2: audio + 20 screenshots + full metadata
    ↓ (if still failing)
Attempt 3: audio + metadata only (no screenshots)
```

Each step also has **3 retry attempts** with exponential backoff for transient network errors.

---

## 🔒 Security & Privacy

- Your Gemini API key is stored only in the local SQLite file on your machine
- The `meetingsense.db` file is `.gitignored` — it is never committed
- Uploaded recordings and screenshots are stored in `./uploads/` on your server only
- Gemini receives your audio/images directly via your own API key — no third-party relay
- In production, consider adding authentication middleware and HTTPS termination (e.g., via nginx)

---

## 🛠️ Troubleshooting

**Analysis fails immediately with "API key not configured"**
→ Go to ⚙️ Settings and re-enter your API key.

**Analysis fails with "File upload stalled"**
→ The Gemini File API is taking longer than 6 minutes to process the audio. This is rare — try again; the server will retry automatically up to 3 times.

**No system audio captured during recording**
→ When sharing your screen, make sure to check **"Share system audio" / "Share tab audio"** in the browser dialog.

**Speaker identification shows "Speaker B/C" instead of real names**
→ Add participant names before recording. For better accuracy, ensure the meeting app shows name labels visibly in the window you share.

**Progress bar stuck / no updates**
→ The SSE connection may have been dropped by a proxy. Refresh the page — the meeting record is preserved in the database and the analysis may have completed.

**Error: `ENOENT: no such file or directory, stat '...dist/index.html'`**
→ You ran `npm start` (production mode) without building the frontend first. The `dist/` folder does not exist until you compile it.
- **Development** (recommended): use `npm run dev` — no build step needed, hot reload included.
- **Production**: run `npm run build` first to compile the frontend, then `npm start`.

**Analysis timed out after 25 minutes**
→ This is the client-side safety timeout. It should only trigger for extremely large recordings (>90 min) combined with slow Gemini API response times. Try again — transient Gemini slowness usually resolves on a second attempt. If it fails repeatedly, check your network connection and the [Gemini API status page](https://status.cloud.google.com/).

---

## 🧪 Testing

The test suite covers unit, regression, and integration tests for both frontend and backend.

### Run tests

```bash
# Run all tests once (CI mode)
npm test

# Watch mode — re-runs on file changes (development)
npm run test:watch
```

### Test coverage

| Test file | Environment | What it covers |
|-----------|-------------|----------------|
| `src/__tests__/analyzeWithServer.test.ts` | jsdom | API client timeout fires at exactly 25 min (not 10, not earlier); SSE stream parsing; error propagation; `clearTimeout` called in both success and failure paths |
| `src/__tests__/AppTimeoutError.test.tsx` | jsdom | App shows "25 minutes" on timeout; never shows "10 minutes"; `updateMeetingStatus('error')` called on any analysis failure; Try Again returns to input state; Back to Dashboard navigates home |
| `src/__tests__/InputSection.test.tsx` | jsdom | All three input modes (Live Record, Upload, Paste Text); recording state machine; participant roster; Analyze button enable/disable rules |
| `server/__tests__/sseHelpers.test.js` | node | SSE `send()` swallows write errors so they cannot revert a committed `'completed'` DB record; `clientGone` flag; keepalive; `finalEnd()` safety |

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📄 License

This project is open source under the [MIT License](LICENSE).

---

## 🙏 Acknowledgements

- [Google Gemini AI](https://ai.google.dev/) — Multi-modal AI processing engine
- [sql.js](https://github.com/sql-js/sql.js/) — SQLite in pure JavaScript (no native deps)
- [Express](https://expressjs.com/) — Backend framework
- [React](https://react.dev/) — Frontend framework
- [Vite](https://vitejs.dev/) — Build tool
- [Tailwind CSS](https://tailwindcss.com/) — Styling

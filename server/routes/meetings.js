import { Router } from 'express';
import { queryAll, queryOne, execute, saveDb } from '../db/database.js';
import { getActiveApiKey, getActiveModel } from './settings.js';
import { analyzeRecording } from '../services/geminiAnalyzer.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${uuidv4().slice(0, 8)}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 500) * 1024 * 1024 }
});

// ── GET /api/meetings/stats/overview ────────────────────────────────────────
// MUST be before /:id to avoid route shadowing
router.get('/stats/overview', (req, res) => {
  try {
    const total        = queryOne('SELECT COUNT(*) as count FROM meetings')?.count || 0;
    const completed    = queryOne("SELECT COUNT(*) as count FROM meetings WHERE status = 'completed'")?.count || 0;
    const processing   = queryOne("SELECT COUNT(*) as count FROM meetings WHERE status = 'processing'")?.count || 0;
    const totalDuration = queryOne('SELECT COALESCE(SUM(duration_minutes), 0) as total FROM meetings WHERE duration_minutes IS NOT NULL')?.total || 0;
    const recentMeetings = queryAll('SELECT id, title, created_at, status FROM meetings ORDER BY created_at DESC LIMIT 5');
    res.json({ total, completed, processing, totalDuration, recentMeetings });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// ── GET /api/meetings ────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const status = req.query.status || '';

    let where  = '1=1';
    const params = [];
    if (search) { where += ' AND (m.title LIKE ? OR mr.executive_summary LIKE ?)'; params.push('%' + search + '%', '%' + search + '%'); }
    if (status) { where += ' AND m.status = ?'; params.push(status); }

    const row   = queryOne('SELECT COUNT(*) as total FROM meetings m LEFT JOIN meeting_results mr ON m.id = mr.meeting_id WHERE ' + where, params);
    const total = row?.total || 0;

    const meetings = queryAll(
      'SELECT m.*, mr.executive_summary FROM meetings m LEFT JOIN meeting_results mr ON m.id = mr.meeting_id WHERE ' + where + ' ORDER BY m.created_at DESC LIMIT ? OFFSET ?',
      [...params, limit, offset]
    );

    res.json({ meetings, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } });
  } catch (err) {
    console.error('List error:', err);
    res.status(500).json({ error: 'Failed to list meetings' });
  }
});

// ── GET /api/meetings/:id ────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const meeting = queryOne('SELECT * FROM meetings WHERE id = ?', [req.params.id]);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const inputs      = queryAll('SELECT * FROM meeting_inputs WHERE meeting_id = ?', [req.params.id]);
    const result      = queryOne('SELECT * FROM meeting_results WHERE meeting_id = ?', [req.params.id]);
    const participants = queryAll('SELECT * FROM meeting_participants WHERE meeting_id = ?', [req.params.id]);
    res.json({ ...meeting, inputs, result: result || null, participants });
  } catch (err) {
    console.error('Get error:', err);
    res.status(500).json({ error: 'Failed to get meeting' });
  }
});

// ── POST /api/meetings ───────────────────────────────────────────────────────
router.post('/', upload.fields([
  { name: 'file',           maxCount: 1   },
  { name: 'participantImgs', maxCount: 200 }
]), (req, res) => {
  try {
    const id    = uuidv4();
    const title = req.body.title || 'Untitled Meeting';
    const text  = req.body.text  || '';

    execute("INSERT INTO meetings (id, title, status) VALUES (?, ?, 'pending')", [id, title]);

    if (text.trim()) {
      execute("INSERT INTO meeting_inputs (meeting_id, input_type, text_content) VALUES (?, 'text', ?)", [id, text]);
    }

    if (req.files?.file?.[0]) {
      const f = req.files.file[0];
      const inputType = f.mimetype.startsWith('audio/') ? 'audio' : 'video';
      execute(
        "INSERT INTO meeting_inputs (meeting_id, input_type, file_path, file_name, file_size, mime_type) VALUES (?, ?, ?, ?, ?, ?)",
        [id, inputType, f.path, f.originalname, f.size, f.mimetype]
      );
    }

    if (req.files?.participantImgs) {
      for (const img of req.files.participantImgs) {
        execute(
          "INSERT INTO meeting_inputs (meeting_id, input_type, file_path, file_name, file_size, mime_type) VALUES (?, 'image', ?, ?, ?, ?)",
          [id, img.path, img.originalname, img.size, img.mimetype]
        );
      }
    }

    saveDb();
    res.status(201).json({ id, status: 'pending' });
  } catch (err) {
    console.error('Create error:', err);
    res.status(500).json({ error: 'Failed to create meeting' });
  }
});

// ── POST /api/meetings/:id/analyze ───────────────────────────────────────────
// Triggers server-side Gemini analysis.
// Streams progress as Server-Sent Events so the browser gets real-time updates
// even for 60–90 minute recordings that take several minutes to analyze.
router.post('/:id/analyze', async (req, res) => {
  const meetingId = req.params.id;

  // Validate before opening SSE stream (can still return JSON errors here)
  const meeting = queryOne('SELECT * FROM meetings WHERE id = ?', [meetingId]);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

  const apiKey = getActiveApiKey();
  if (!apiKey) return res.status(400).json({ error: 'Gemini API key not configured. Please add it in Settings.' });

  // Model: request body > DB setting > default
  const model = (req.body?.model || getActiveModel()).trim();

  // ── Open SSE stream ────────────────────────────────────────────────────────
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  // Track whether the client has disconnected. Used to decide whether a write
  // error in the catch block was caused by a legitimate analysis failure or
  // merely by the client closing the SSE connection.
  let clientGone = false;
  req.on('close', () => { clientGone = true; });

  // send() must NEVER throw — a client disconnect causes res.write() to reject
  // with ECONNRESET/EPIPE, and if that propagates out of the try block it would
  // run the catch block and wrongly revert a just-saved 'completed' record to
  // 'error'. Swallowing the write error here is intentional and safe: the DB
  // has already been updated before send() is called for the done event.
  const send = (data) => {
    if (res.writableEnded || clientGone) return;
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (_) {
      clientGone = true; // mark so further writes are skipped
    }
  };

  // Keepalive comment line every 10 s to prevent proxy / browser timeouts.
  // 10 s is conservative: even the most aggressive reverse-proxy idle timeout
  // (typically 15–30 s) will see data before it fires.  For the dev Vite
  // proxy this is belt-and-braces since we also set proxyTimeout:0 there,
  // but it also helps in production behind nginx/caddy/cloudflare.
  // Also wrapped in try/catch for the same reason as send() above.
  const keepalive = setInterval(() => {
    if (res.writableEnded || clientGone) return;
    try { res.write(': keepalive\n\n'); } catch (_) { clientGone = true; }
  }, 10_000);

  const cleanup = () => clearInterval(keepalive);

  try {
    // Update meeting status to processing
    execute(
      "UPDATE meetings SET status = 'processing', error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [meetingId]
    );
    saveDb();

    // Gather stored inputs
    const inputs = queryAll('SELECT * FROM meeting_inputs WHERE meeting_id = ?', [meetingId]);

    const audioInput = inputs.find(i => i.input_type === 'audio' || i.input_type === 'video');
    const imageInputs = inputs.filter(i => i.input_type === 'image');
    const textInput   = inputs.find(i => i.input_type === 'text');

    const audioFilePath = audioInput?.file_path  || null;
    const audioMimeType = audioInput?.mime_type   || 'audio/webm';
    const imagePaths    = imageInputs.map(i => i.file_path).filter(Boolean);
    const metadataText  = textInput?.text_content || '';

    send({ stage: 'Starting', detail: `Model: ${model}`, percent: 5 });

    // Run analysis — emitting progress events throughout
    const rawMarkdown = await analyzeRecording({
      audioFilePath,
      audioMimeType,
      metadataText,
      imagePaths,
      model,
      apiKey,
      emit: (stage, detail) => {
        send({ stage, detail });
        console.log(`[Analysis:${meetingId}] ${stage}${detail ? ' — ' + detail : ''}`);
      },
    });

    // Extract metadata from result
    const execMatch = rawMarkdown.match(/# 1\. Executive Summary[\s\S]*?\n([\s\S]*?)(?=\n# 2)/);
    const execSummary = execMatch ? execMatch[1].trim() : '';

    const metaMatch = rawMarkdown.match(/```json\s*([\s\S]*?)```/);
    const metaJson  = metaMatch ? metaMatch[1].trim() : '{}';

    // Derive title and duration
    let title    = meeting.title || 'Untitled Meeting';
    let duration = null;
    try {
      const meta = JSON.parse(metaJson);
      if (meta.title && meta.title !== 'Untitled Meeting') title = meta.title;
      if (meta.duration_minutes) duration = parseInt(meta.duration_minutes) || null;
    } catch (e) {}

    // Persist result
    execute("DELETE FROM meeting_results WHERE meeting_id = ?", [meetingId]);
    execute(
      "INSERT INTO meeting_results (meeting_id, raw_markdown, executive_summary, metadata_json) VALUES (?, ?, ?, ?)",
      [meetingId, rawMarkdown, execSummary, metaJson]
    );
    execute(
      "UPDATE meetings SET status = 'completed', title = ?, duration_minutes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [title, duration, meetingId]
    );
    saveDb();

    send({ stage: 'Done', detail: `${rawMarkdown.length} chars`, percent: 100, done: true, result: rawMarkdown });
  } catch (err) {
    console.error(`[Analysis:${meetingId}] Error:`, err.message);
    try {
      execute(
        "UPDATE meetings SET status = 'error', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [err.message, meetingId]
      );
      saveDb();
    } catch (dbErr) {
      console.error('Failed to save error state:', dbErr.message);
    }
    send({ stage: 'Error', error: err.message, done: true });
  } finally {
    cleanup();
    if (!res.writableEnded) {
      try { res.end(); } catch (_) {}
    }
  }
});

// ── PUT /api/meetings/:id/result ─────────────────────────────────────────────
router.put('/:id/result', (req, res) => {
  try {
    const { raw_markdown, executive_summary, metadata_json } = req.body;

    execute("DELETE FROM meeting_results WHERE meeting_id = ?", [req.params.id]);
    execute(
      "INSERT INTO meeting_results (meeting_id, raw_markdown, executive_summary, metadata_json) VALUES (?, ?, ?, ?)",
      [req.params.id, raw_markdown, executive_summary || '', metadata_json || '{}']
    );

    let title    = 'Untitled Meeting';
    let duration = null;
    if (metadata_json) {
      try {
        const meta = JSON.parse(metadata_json);
        if (meta.title) title = meta.title;
        if (meta.duration_minutes) duration = parseInt(meta.duration_minutes) || null;
      } catch (e) {}
    }

    execute(
      "UPDATE meetings SET status = 'completed', title = ?, duration_minutes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [title, duration, req.params.id]
    );
    saveDb();
    res.json({ success: true });
  } catch (err) {
    console.error('Save result error:', err);
    res.status(500).json({ error: 'Failed to save result' });
  }
});

// ── PUT /api/meetings/:id/status ─────────────────────────────────────────────
router.put('/:id/status', (req, res) => {
  try {
    const { status, error_message } = req.body;
    execute(
      "UPDATE meetings SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [status, error_message || null, req.params.id]
    );
    saveDb();
    res.json({ success: true });
  } catch (err) {
    console.error('Status error:', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// ── DELETE /api/meetings/:id ─────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const inputs = queryAll(
      'SELECT file_path FROM meeting_inputs WHERE meeting_id = ? AND file_path IS NOT NULL',
      [req.params.id]
    );
    for (const input of inputs) {
      if (input.file_path && fs.existsSync(input.file_path)) {
        try { fs.unlinkSync(input.file_path); } catch (e) {}
      }
    }
    execute('DELETE FROM meeting_participants WHERE meeting_id = ?', [req.params.id]);
    execute('DELETE FROM meeting_inputs       WHERE meeting_id = ?', [req.params.id]);
    execute('DELETE FROM meeting_results      WHERE meeting_id = ?', [req.params.id]);
    execute('DELETE FROM meetings             WHERE id = ?',         [req.params.id]);
    saveDb();
    res.json({ success: true });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete meeting' });
  }
});

// ── GET /api/meetings/:id/export ─────────────────────────────────────────────
router.get('/:id/export', (req, res) => {
  try {
    const result  = queryOne('SELECT * FROM meeting_results WHERE meeting_id = ?', [req.params.id]);
    if (!result) return res.status(404).json({ error: 'No result found' });
    const meeting = queryOne('SELECT * FROM meetings WHERE id = ?', [req.params.id]);
    const fname   = (meeting?.title || 'meeting').replace(/[^a-z0-9]/gi, '_');
    res.setHeader('Content-Type', 'text/markdown');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}.md"`);
    res.send(result.raw_markdown);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Failed to export' });
  }
});

// ── Multer error handler ─────────────────────────────────────────────────────
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('Multer error:', err.code, err.message, err.field);
    const messages = {
      LIMIT_FILE_SIZE:       `File too large. Maximum size is ${parseInt(process.env.MAX_FILE_SIZE_MB) || 500} MB.`,
      LIMIT_UNEXPECTED_FILE: `Too many files uploaded for field "${err.field}".`,
      LIMIT_FILE_COUNT:      'Too many files uploaded.',
      LIMIT_FIELD_KEY:       'Field name too long.',
      LIMIT_FIELD_VALUE:     'Field value too long.',
      LIMIT_FIELD_COUNT:     'Too many fields.',
      LIMIT_PART_COUNT:      'Too many parts.',
    };
    return res.status(413).json({ error: messages[err.code] || err.message });
  }
  next(err);
});

export default router;

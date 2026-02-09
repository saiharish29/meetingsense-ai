import { Router } from 'express';
import { queryAll, queryOne, execute, saveDb } from '../db/database.js';
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

// Stats - MUST be before /:id
router.get('/stats/overview', (req, res) => {
  try {
    const total = queryOne('SELECT COUNT(*) as count FROM meetings')?.count || 0;
    const completed = queryOne("SELECT COUNT(*) as count FROM meetings WHERE status = 'completed'")?.count || 0;
    const processing = queryOne("SELECT COUNT(*) as count FROM meetings WHERE status = 'processing'")?.count || 0;
    const totalDuration = queryOne('SELECT COALESCE(SUM(duration_minutes), 0) as total FROM meetings WHERE duration_minutes IS NOT NULL')?.total || 0;
    const recentMeetings = queryAll('SELECT id, title, created_at, status FROM meetings ORDER BY created_at DESC LIMIT 5');
    res.json({ total, completed, processing, totalDuration, recentMeetings });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// List meetings
router.get('/', (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const status = req.query.status || '';

    let where = '1=1';
    const params = [];
    if (search) { where += ' AND (m.title LIKE ? OR mr.executive_summary LIKE ?)'; params.push('%' + search + '%', '%' + search + '%'); }
    if (status) { where += ' AND m.status = ?'; params.push(status); }

    const row = queryOne('SELECT COUNT(*) as total FROM meetings m LEFT JOIN meeting_results mr ON m.id = mr.meeting_id WHERE ' + where, params);
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

// Get single meeting
router.get('/:id', (req, res) => {
  try {
    const meeting = queryOne('SELECT * FROM meetings WHERE id = ?', [req.params.id]);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const inputs = queryAll('SELECT * FROM meeting_inputs WHERE meeting_id = ?', [req.params.id]);
    const result = queryOne('SELECT * FROM meeting_results WHERE meeting_id = ?', [req.params.id]);
    const participants = queryAll('SELECT * FROM meeting_participants WHERE meeting_id = ?', [req.params.id]);
    res.json({ ...meeting, inputs, result: result || null, participants });
  } catch (err) {
    console.error('Get error:', err);
    res.status(500).json({ error: 'Failed to get meeting' });
  }
});

// Create meeting
router.post('/', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'participantImgs', maxCount: 200 }
]), (req, res) => {
  try {
    const id = uuidv4();
    const title = req.body.title || 'Untitled Meeting';
    const text = req.body.text || '';

    execute("INSERT INTO meetings (id, title, status) VALUES (?, ?, 'pending')", [id, title]);

    if (text.trim()) {
      execute("INSERT INTO meeting_inputs (meeting_id, input_type, text_content) VALUES (?, 'text', ?)", [id, text]);
    }

    if (req.files && req.files.file && req.files.file[0]) {
      const f = req.files.file[0];
      const inputType = f.mimetype.startsWith('audio/') ? 'audio' : 'video';
      execute("INSERT INTO meeting_inputs (meeting_id, input_type, file_path, file_name, file_size, mime_type) VALUES (?, ?, ?, ?, ?, ?)", [id, inputType, f.path, f.originalname, f.size, f.mimetype]);
    }

    if (req.files && req.files.participantImgs) {
      for (const img of req.files.participantImgs) {
        execute("INSERT INTO meeting_inputs (meeting_id, input_type, file_path, file_name, file_size, mime_type) VALUES (?, 'image', ?, ?, ?, ?)", [id, img.path, img.originalname, img.size, img.mimetype]);
      }
    }

    saveDb();
    res.status(201).json({ id, status: 'pending' });
  } catch (err) {
    console.error('Create error:', err);
    res.status(500).json({ error: 'Failed to create meeting' });
  }
});

// Save analysis result
router.put('/:id/result', (req, res) => {
  try {
    const { raw_markdown, executive_summary, metadata_json } = req.body;

    // Delete existing result first, then insert
    execute("DELETE FROM meeting_results WHERE meeting_id = ?", [req.params.id]);
    execute("INSERT INTO meeting_results (meeting_id, raw_markdown, executive_summary, metadata_json) VALUES (?, ?, ?, ?)", [req.params.id, raw_markdown, executive_summary || '', metadata_json || '{}']);

    let title = 'Untitled Meeting';
    let duration = null;
    if (metadata_json) {
      try {
        const meta = JSON.parse(metadata_json);
        if (meta.title) title = meta.title;
        if (meta.duration_minutes) duration = parseInt(meta.duration_minutes) || null;
      } catch (e) {}
    }

    execute("UPDATE meetings SET status = 'completed', title = ?, duration_minutes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [title, duration, req.params.id]);
    saveDb();
    res.json({ success: true });
  } catch (err) {
    console.error('Save result error:', err);
    res.status(500).json({ error: 'Failed to save result' });
  }
});

// Update status
router.put('/:id/status', (req, res) => {
  try {
    const { status, error_message } = req.body;
    execute("UPDATE meetings SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [status, error_message || null, req.params.id]);
    saveDb();
    res.json({ success: true });
  } catch (err) {
    console.error('Status error:', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Delete meeting
router.delete('/:id', (req, res) => {
  try {
    const inputs = queryAll('SELECT file_path FROM meeting_inputs WHERE meeting_id = ? AND file_path IS NOT NULL', [req.params.id]);
    for (const input of inputs) {
      if (input.file_path && fs.existsSync(input.file_path)) fs.unlinkSync(input.file_path);
    }
    execute('DELETE FROM meeting_participants WHERE meeting_id = ?', [req.params.id]);
    execute('DELETE FROM meeting_inputs WHERE meeting_id = ?', [req.params.id]);
    execute('DELETE FROM meeting_results WHERE meeting_id = ?', [req.params.id]);
    execute('DELETE FROM meetings WHERE id = ?', [req.params.id]);
    saveDb();
    res.json({ success: true });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete meeting' });
  }
});

// Export as markdown
router.get('/:id/export', (req, res) => {
  try {
    const result = queryOne('SELECT * FROM meeting_results WHERE meeting_id = ?', [req.params.id]);
    if (!result) return res.status(404).json({ error: 'No result found' });
    const meeting = queryOne('SELECT * FROM meetings WHERE id = ?', [req.params.id]);
    res.setHeader('Content-Type', 'text/markdown');
    res.setHeader('Content-Disposition', 'attachment; filename="' + (meeting?.title || 'meeting').replace(/[^a-z0-9]/gi, '_') + '.md"');
    res.send(result.raw_markdown);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Failed to export' });
  }
});

// Multer error handler — catch file limit errors with clear messages
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('Multer error:', err.code, err.message, err.field);
    const messages = {
      LIMIT_FILE_SIZE: `File too large. Maximum size is ${parseInt(process.env.MAX_FILE_SIZE_MB) || 500}MB.`,
      LIMIT_UNEXPECTED_FILE: `Too many files uploaded for field "${err.field}".`,
      LIMIT_FILE_COUNT: 'Too many files uploaded.',
      LIMIT_FIELD_KEY: 'Field name too long.',
      LIMIT_FIELD_VALUE: 'Field value too long.',
      LIMIT_FIELD_COUNT: 'Too many fields.',
      LIMIT_PART_COUNT: 'Too many parts.',
    };
    return res.status(413).json({ error: messages[err.code] || err.message });
  }
  next(err);
});

export default router;

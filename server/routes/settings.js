import { Router } from 'express';
import { queryOne, execute, getDb } from '../db/database.js';

const router = Router();

// Check if API key is configured
router.get('/api-key/status', (req, res) => {
  const hasEnvKey = !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
  let hasDbKey = false;
  try {
    const row = queryOne("SELECT value FROM app_settings WHERE key = 'gemini_api_key'");
    hasDbKey = !!(row && row.value && String(row.value).trim());
  } catch (e) {}
  res.json({ configured: hasEnvKey || hasDbKey, source: hasEnvKey ? 'env' : hasDbKey ? 'db' : 'none' });
});

// Save API key
router.post('/api-key', (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey || !apiKey.trim()) return res.status(400).json({ error: 'API key is required' });

    // Upsert
    const existing = queryOne("SELECT key FROM app_settings WHERE key = 'gemini_api_key'");
    if (existing) {
      execute("UPDATE app_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'gemini_api_key'", [apiKey.trim()]);
    } else {
      execute("INSERT INTO app_settings (key, value) VALUES ('gemini_api_key', ?)", [apiKey.trim()]);
    }

    process.env.GEMINI_API_KEY = apiKey.trim();
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving API key:', err);
    res.status(500).json({ error: 'Failed to save API key' });
  }
});

// Validate API key
router.post('/api-key/validate', async (req, res) => {
  try {
    const { apiKey } = req.body;
    const keyToTest = apiKey || process.env.GEMINI_API_KEY;
    if (!keyToTest) return res.json({ valid: false, error: 'No API key provided' });

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + keyToTest);
    if (response.ok) {
      res.json({ valid: true });
    } else {
      const data = await response.json().catch(() => ({}));
      res.json({ valid: false, error: data.error?.message || 'Invalid API key' });
    }
  } catch (err) {
    res.json({ valid: false, error: 'Could not validate key - network error' });
  }
});

// Get active API key
router.get('/api-key/active', (req, res) => {
  const key = getActiveApiKey();
  if (key) {
    res.json({ key });
  } else {
    res.status(404).json({ error: 'No API key configured' });
  }
});

export function getActiveApiKey() {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    return process.env.GEMINI_API_KEY.trim();
  }
  try {
    const row = queryOne("SELECT value FROM app_settings WHERE key = 'gemini_api_key'");
    if (row && row.value && String(row.value).trim()) return String(row.value).trim();
  } catch (e) {}
  return null;
}

export default router;

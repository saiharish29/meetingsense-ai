import { Router } from 'express';
import { queryOne, execute, getDb } from '../db/database.js';
import { DEFAULT_MODEL, AUDIO_CAPABLE_MODELS } from '../constants.js';

const router = Router();

// ── API Key helpers ──────────────────────────────────────────────────────────

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

export function getActiveModel() {
  try {
    const row = queryOne("SELECT value FROM app_settings WHERE key = 'gemini_model'");
    if (row && row.value && String(row.value).trim()) return String(row.value).trim();
  } catch (e) {}
  return DEFAULT_MODEL;
}

// ── GET /api/settings/api-key/status ────────────────────────────────────────
router.get('/api-key/status', (req, res) => {
  const hasEnvKey = !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
  let hasDbKey = false;
  try {
    const row = queryOne("SELECT value FROM app_settings WHERE key = 'gemini_api_key'");
    hasDbKey = !!(row && row.value && String(row.value).trim());
  } catch (e) {}
  res.json({
    configured: hasEnvKey || hasDbKey,
    source: hasEnvKey ? 'env' : hasDbKey ? 'db' : 'none',
    model: getActiveModel(),
  });
});

// ── POST /api/settings/api-key ───────────────────────────────────────────────
router.post('/api-key', (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey || !apiKey.trim()) return res.status(400).json({ error: 'API key is required' });

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

// ── POST /api/settings/api-key/validate ─────────────────────────────────────
router.post('/api-key/validate', async (req, res) => {
  try {
    const { apiKey } = req.body;
    const keyToTest = (apiKey || process.env.GEMINI_API_KEY || '').trim();
    if (!keyToTest) return res.json({ valid: false, error: 'No API key provided' });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${keyToTest}`
    );
    if (response.ok) {
      res.json({ valid: true });
    } else {
      const data = await response.json().catch(() => ({}));
      res.json({ valid: false, error: data.error?.message || 'Invalid API key' });
    }
  } catch (err) {
    res.json({ valid: false, error: 'Could not validate key — network error' });
  }
});

// ── GET /api/settings/api-key/active ────────────────────────────────────────
router.get('/api-key/active', (req, res) => {
  const key = getActiveApiKey();
  if (key) {
    res.json({ key });
  } else {
    res.status(404).json({ error: 'No API key configured' });
  }
});

// ── GET /api/settings/models ─────────────────────────────────────────────────
// Fetches available Gemini models from the API and filters for audio-capable ones.
// Optionally accepts ?key=... to use a specific key (during setup before saving).
router.get('/models', async (req, res) => {
  try {
    const apiKey = (req.query.key || getActiveApiKey() || '').trim();
    if (!apiKey) return res.status(400).json({ error: 'API key not configured' });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`
    );

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: data.error?.message || 'Failed to fetch models',
      });
    }

    const data = await response.json();
    const rawModels = data.models || [];

    // Filter: must support generateContent + be a gemini model
    const capable = rawModels.filter(m => {
      const name = (m.name || '').toLowerCase();
      const methods = m.supportedGenerationMethods || [];
      return name.includes('gemini') && methods.includes('generateContent');
    });

    // Sort: put known good audio models first, then by name
    const audioSet = new Set(AUDIO_CAPABLE_MODELS);
    capable.sort((a, b) => {
      const aId = a.name.replace('models/', '');
      const bId = b.name.replace('models/', '');
      const aPriority = audioSet.has(aId) ? 0 : 1;
      const bPriority = audioSet.has(bId) ? 0 : 1;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return aId.localeCompare(bId);
    });

    const models = capable.map(m => ({
      id: m.name.replace('models/', ''),
      displayName: m.displayName || m.name.replace('models/', ''),
      description: m.description || '',
      inputTokenLimit: m.inputTokenLimit || null,
      isRecommended: audioSet.has(m.name.replace('models/', '')),
    }));

    res.json({ models, currentModel: getActiveModel() });
  } catch (err) {
    console.error('Error fetching models:', err);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

// ── POST /api/settings/model ─────────────────────────────────────────────────
router.post('/model', (req, res) => {
  try {
    const { model } = req.body;
    if (!model || !model.trim()) return res.status(400).json({ error: 'Model ID is required' });

    const existing = queryOne("SELECT key FROM app_settings WHERE key = 'gemini_model'");
    if (existing) {
      execute("UPDATE app_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'gemini_model'", [model.trim()]);
    } else {
      execute("INSERT INTO app_settings (key, value) VALUES ('gemini_model', ?)", [model.trim()]);
    }

    res.json({ success: true, model: model.trim() });
  } catch (err) {
    console.error('Error saving model:', err);
    res.status(500).json({ error: 'Failed to save model preference' });
  }
});

// ── GET /api/settings/model ──────────────────────────────────────────────────
router.get('/model', (req, res) => {
  res.json({ model: getActiveModel() });
});

export default router;

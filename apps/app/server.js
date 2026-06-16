'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.RENDERER_PORT || 3000;

// ── Static: QweenRender.html + anything else in public/ ──────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    // Allow Playwright (same machine) and QweenApp (localhost:5000) to fetch
    res.setHeader('Access-Control-Allow-Origin', '*');
    // ZIPs should not be cached between renders
    if (filePath.endsWith('.zip')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  const projectsDir = path.join(__dirname, 'public', 'projects');
  const files = fs.existsSync(projectsDir)
    ? fs.readdirSync(projectsDir).filter(f => f.endsWith('.zip'))
    : [];
  res.json({ status: 'ok', projects: files.length, port: PORT });
});

// ── List stored projects ──────────────────────────────────────────────────────
app.get('/projects', (_req, res) => {
  const projectsDir = path.join(__dirname, 'public', 'projects');
  if (!fs.existsSync(projectsDir)) return res.json({ projects: [] });
  const files = fs.readdirSync(projectsDir)
    .filter(f => f.endsWith('.zip'))
    .map(f => ({
      id:      path.basename(f, '.zip'),
      url:     `/projects/${f}`,
      size_mb: +(fs.statSync(path.join(projectsDir, f)).size / 1_048_576).toFixed(2),
    }));
  res.json({ projects: files });
});

// ── Delete a stored project ───────────────────────────────────────────────────
app.delete('/projects/:id', (req, res) => {
  const file = path.join(__dirname, 'public', 'projects', `${req.params.id}.zip`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(file);
  res.json({ deleted: req.params.id });
});

app.listen(PORT, () => {
  console.log(`[qween-app] Renderer server running at http://localhost:${PORT}`);
  console.log(`[qween-app] QweenRender: http://localhost:${PORT}/QweenRender.html`);
});

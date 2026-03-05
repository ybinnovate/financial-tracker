require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { initDb } = require('./db');
const OpenAI = require('openai');
const { Client } = require('@notionhq/client');

let db = null;
const app = express();
const PORT = process.env.PORT || 3000;

// ── Uploads ─────────────────────────────────────────────────
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + suffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ── OpenRouter (Vision AI) ──────────────────────────────────
let ai = null;
const VISION_MODEL = process.env.VISION_MODEL || 'google/gemini-2.0-flash-001';

if (process.env.OPENROUTER_API_KEY) {
  ai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
  });
  console.log(`Vision AI configured via OpenRouter (model: ${VISION_MODEL})`);
} else {
  console.warn('Warning: OPENROUTER_API_KEY not set. Image extraction disabled.');
}

// ── Notion ──────────────────────────────────────────────────
let notion = null;
const NOTION_DB_ID = process.env.NOTION_DATABASE_ID || '';

if (process.env.NOTION_API_KEY) {
  notion = new Client({ auth: process.env.NOTION_API_KEY });
  console.log('Notion client configured.');
} else {
  console.warn('Warning: NOTION_API_KEY not set. Notion sync disabled.');
}

// ── Middleware ───────────────────────────────────────────────
app.use(express.json());
app.use('/uploads', express.static(uploadDir));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// ── API: Get all records ────────────────────────────────────
app.get('/api/records', (req, res) => {
  const records = db.prepare('SELECT * FROM records ORDER BY date DESC').all();
  res.json(records);
});

// ── API: Create / Update record ─────────────────────────────
app.post('/api/records',
  upload.fields([
    { name: 'odometerImage', maxCount: 1 },
    { name: 'gasReceiptImage', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const { date, earnings, gasCost, notes, personalMiles, odometerReading } = req.body;
      const files = req.files || {};
      const odometerImage = files['odometerImage']?.[0];
      const gasReceiptImage = files['gasReceiptImage']?.[0];

      let extractedOdometer = null;
      let extractedGasCost = null;
      let extractionError = null;

      // ── Extract odometer from image ───────────────────────
      if (odometerImage && ai) {
        try {
          const base64 = fs.readFileSync(odometerImage.path, 'base64');
          const resp = await ai.chat.completions.create({
            model: VISION_MODEL,
            messages: [{
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${odometerImage.mimetype};base64,${base64}` } },
                { type: 'text', text: 'Identify the main odometer reading (total mileage) from this dashboard image. It is usually the largest integer number. Ignore trip meters. Return ONLY the numeric value.' }
              ]
            }]
          });
          const text = resp.choices?.[0]?.message?.content?.trim() || '';
          console.log('Odometer AI response:', text);
          const match = text.match(/[\d,]+(\.\d+)?/);
          if (match) extractedOdometer = parseFloat(match[0].replace(/,/g, ''));
          else extractionError = `Odometer extraction failed: AI returned "${text}"`;
        } catch (err) {
          console.error('Odometer extraction error:', err.message);
          extractionError = `Odometer extraction error: ${err.message}`;
        }
      }

      // ── Extract gas cost + date from receipt ──────────────
      let extractedDate = null;
      if (gasReceiptImage && ai) {
        try {
          const base64 = fs.readFileSync(gasReceiptImage.path, 'base64');
          const resp = await ai.chat.completions.create({
            model: VISION_MODEL,
            messages: [{
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${gasReceiptImage.mimetype};base64,${base64}` } },
                { type: 'text', text: 'Analyze this gas receipt. Find the TOTAL amount paid and the DATE. Return a raw JSON object with keys "amount" (number) and "date" (string in YYYY-MM-DD format). No markdown.' }
              ]
            }]
          });
          let text = resp.choices?.[0]?.message?.content?.trim() || '';
          console.log('Receipt AI response:', text);
          text = text.replace(/```json/g, '').replace(/```/g, '').trim();

          try {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const data = JSON.parse(jsonMatch[0]);
              if (data.amount) extractedGasCost = parseFloat(data.amount);
              if (data.date) extractedDate = data.date;
            }
          } catch (e) {
            // Fallback regex
            const amountMatch = text.match(/\$?\s*(\d+\.\d{2})/);
            if (amountMatch) extractedGasCost = parseFloat(amountMatch[1]);
          }
        } catch (err) {
          console.error('Receipt extraction error:', err.message);
        }
      }

      // ── Determine final values ────────────────────────────
      const finalDate = extractedDate || date;
      let id = req.body.id;
      let existing = null;

      if (id) {
        existing = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
        if (!existing) id = uuidv4();
      } else {
        existing = db.prepare('SELECT * FROM records WHERE date = ?').get(finalDate);
        id = existing ? existing.id : uuidv4();
      }

      const hasEarnings = earnings !== undefined && earnings !== '';
      const hasGasCost = gasCost !== undefined && gasCost !== '';
      const hasOdometer = odometerReading !== undefined && odometerReading !== '';
      const hasPersonalMiles = personalMiles !== undefined && personalMiles !== '';

      const finalEarnings = hasEarnings ? parseFloat(earnings) : (existing?.earnings || 0);
      const finalPersonalMiles = hasPersonalMiles ? parseFloat(personalMiles) : (existing?.personal_miles || 0);

      let finalGasCost = existing?.gas_cost || 0;
      if (hasGasCost) finalGasCost = parseFloat(gasCost);
      else if (extractedGasCost !== null) finalGasCost = extractedGasCost;

      let finalOdometer = existing?.odometer_reading || null;
      if (hasOdometer) finalOdometer = parseFloat(odometerReading);
      else if (extractedOdometer !== null) finalOdometer = extractedOdometer;

      const odometerImagePath = odometerImage ? `/uploads/${odometerImage.filename}` : (existing?.odometer_image_path || null);
      const gasReceiptImagePath = gasReceiptImage ? `/uploads/${gasReceiptImage.filename}` : (existing?.gas_receipt_image_path || null);

      const newNotes = notes || '';
      const finalNotes = existing?.notes ? (existing.notes + (newNotes ? '\n' + newNotes : '')) : newNotes;

      if (existing) {
        db.prepare(`
          UPDATE records SET odometer_reading=?, odometer_image_path=?, earnings=?, gas_cost=?, gas_receipt_image_path=?, notes=?, personal_miles=? WHERE id=?
        `).run(finalOdometer, odometerImagePath, finalEarnings, finalGasCost, gasReceiptImagePath, finalNotes, finalPersonalMiles, id);
      } else {
        db.prepare(`
          INSERT INTO records (id, date, odometer_reading, odometer_image_path, earnings, gas_cost, gas_receipt_image_path, notes, notion_page_id, personal_miles)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, finalDate, finalOdometer, odometerImagePath, finalEarnings, finalGasCost, gasReceiptImagePath, finalNotes, null, finalPersonalMiles);
      }

      // ── Notion sync ───────────────────────────────────────
      let syncError = null;
      if (notion && NOTION_DB_ID) {
        try {
          const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
          let notionPageId = existing?.notion_page_id || null;

          if (!notionPageId) {
            try {
              const q = await notion.databases.query({
                database_id: NOTION_DB_ID,
                filter: { property: 'Date', date: { equals: finalDate } }
              });
              if (q.results.length > 0) {
                notionPageId = q.results[0].id;
                db.prepare('UPDATE records SET notion_page_id = ? WHERE id = ?').run(notionPageId, id);
              }
            } catch (qErr) {
              console.error('Notion query error:', qErr.message);
            }
          }

          const properties = {
            'Record': { title: [{ text: { content: `Trip on ${finalDate}` } }] },
            'Date': { date: { start: finalDate } },
            'Start Miles': { number: finalOdometer },
            'Earnings': { number: finalEarnings },
            'Gas': { number: finalGasCost || 0 },
            'Notes': { rich_text: [{ text: { content: finalNotes || '' } }] },
          };

          if (odometerImagePath) {
            properties['Mileage Image'] = { url: `${appUrl}${odometerImagePath}` };
          }
          if (gasReceiptImagePath) {
            properties['Gas Receipt'] = { url: `${appUrl}${gasReceiptImagePath}` };
          }

          if (notionPageId) {
            await notion.pages.update({ page_id: notionPageId, properties });
          } else {
            const newPage = await notion.pages.create({ parent: { database_id: NOTION_DB_ID }, properties });
            db.prepare('UPDATE records SET notion_page_id = ? WHERE id = ?').run(newPage.id, id);
          }
        } catch (nErr) {
          console.error('Notion sync error:', nErr.message);
          syncError = nErr.message;
        }
      }

      const updated = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
      res.json({ ...updated, syncError, extractionError });

    } catch (error) {
      console.error('Error saving record:', error);
      res.status(500).json({ error: 'Failed to save record' });
    }
  }
);

// ── API: Delete record ──────────────────────────────────────
app.delete('/api/records/:id', async (req, res) => {
  try {
    const record = db.prepare('SELECT * FROM records WHERE id = ?').get(req.params.id);
    if (!record) return res.status(404).json({ error: 'Not found' });

    if (record.notion_page_id && notion) {
      try {
        await notion.pages.update({ page_id: record.notion_page_id, archived: true });
      } catch (e) {
        console.error('Notion delete error:', e.message);
      }
    }

    db.prepare('DELETE FROM records WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting record:', error);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// ── API: Config status ──────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({
    notionConfigured: !!(notion && NOTION_DB_ID),
    aiConfigured: !!ai,
    visionModel: VISION_MODEL
  });
});

// ── SPA fallback ────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Error handler ───────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Start ───────────────────────────────────────────────────
(async () => {
  db = await initDb();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
})();

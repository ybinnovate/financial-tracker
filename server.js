require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { initDb } = require('./db');
const OpenAI = require('openai');
const { Client } = require('@notionhq/client');
const exifr = require('exifr');
const pdfParse = require('pdf-parse');

let db = null;
const app = express();
const PORT = process.env.PORT || 3000;

// ── Uploads ─────────────────────────────────────────────────
const dataDir = process.env.DATA_DIR || process.cwd();
const uploadDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

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

// ── API: Transactions (financial tracker) ───────────────────
app.get('/api/transactions', (req, res) => {
  const rows = db.prepare('SELECT * FROM transactions ORDER BY date DESC').all();
  res.json(rows);
});

app.post('/api/transactions', (req, res) => {
  const { id, type, amount, category, date, description, business, receipt_image_path } = req.body;
  if (!id || !type || !amount || !category || !date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  db.prepare(`
    INSERT INTO transactions (id, type, amount, category, date, description, business, receipt_image_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, type, parseFloat(amount), category, date, description || '', business || '', receipt_image_path || null);
  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  res.json(row);
});

app.post('/api/transactions/bulk', (req, res) => {
  const { transactions } = req.body;
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return res.status(400).json({ error: 'No transactions provided' });
  }
  let saved = 0;
  for (const tx of transactions) {
    if (!tx.id || !tx.type || !tx.amount || !tx.category || !tx.date) continue;
    db.prepare(`
      INSERT INTO transactions (id, type, amount, category, date, description, business)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(tx.id, tx.type, parseFloat(tx.amount), tx.category, tx.date, tx.description || '', tx.business || '');
    saved++;
  }
  res.json({ success: true, saved });
});

app.delete('/api/transactions/:id', (req, res) => {
  db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── API: Bills ─────────────────────────────────────────────
app.get('/api/bills', (req, res) => {
  const rows = db.prepare('SELECT * FROM bills ORDER BY name').all();
  res.json(rows);
});

app.post('/api/bills', (req, res) => {
  const { id, name, is_recurring, default_amount, due_day, notes } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'Missing required fields' });
  db.prepare(`
    INSERT INTO bills (id, name, is_recurring, default_amount, due_day, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name.trim(), is_recurring ? 1 : 0, parseFloat(default_amount) || 0, parseInt(due_day) || 1, notes || '');
  res.json(db.prepare('SELECT * FROM bills WHERE id = ?').get(id));
});

app.delete('/api/bills/:id', (req, res) => {
  db.prepare('DELETE FROM bill_payments WHERE bill_id = ?').run(req.params.id);
  db.prepare('DELETE FROM bills WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/bill-payments', (req, res) => {
  const month = req.query.month;
  if (!month) return res.status(400).json({ error: 'month query param required' });

  // Auto-generate pending entries for recurring bills
  const recurringBills = db.prepare('SELECT * FROM bills WHERE is_recurring = 1').all();
  for (const bill of recurringBills) {
    const existing = db.prepare('SELECT id FROM bill_payments WHERE bill_id = ? AND month = ?').get(bill.id, month);
    if (!existing) {
      const payId = require('uuid').v4();
      const dueDay = Math.min(bill.due_day || 1, 28);
      const dueDate = `${month}-${String(dueDay).padStart(2, '0')}`;
      db.prepare(`
        INSERT INTO bill_payments (id, bill_id, month, due_date, amount_due, total_balance, amount_paid, status)
        VALUES (?, ?, ?, ?, ?, 0, 0, 'pending')
      `).run(payId, bill.id, month, dueDate, bill.default_amount || 0);
    }
  }

  const rows = db.prepare(`
    SELECT bp.*, b.name as bill_name, b.is_recurring
    FROM bill_payments bp
    JOIN bills b ON bp.bill_id = b.id
    WHERE bp.month = ?
    ORDER BY b.name
  `).all(month);
  res.json(rows);
});

app.post('/api/bill-payments', (req, res) => {
  const { id, bill_id, month, due_date, amount_due, total_balance, amount_paid, date_paid, notes } = req.body;
  if (!id || !bill_id || !month) return res.status(400).json({ error: 'Missing required fields' });

  const due = parseFloat(amount_due) || 0;
  const paid = parseFloat(amount_paid) || 0;
  let status = 'pending';
  if (paid > 0 && paid >= due) status = 'paid';
  else if (paid > 0) status = 'partial';

  // Upsert: delete old then insert
  db.prepare('DELETE FROM bill_payments WHERE id = ?').run(id);
  db.prepare(`
    INSERT INTO bill_payments (id, bill_id, month, due_date, amount_due, total_balance, amount_paid, date_paid, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, bill_id, month, due_date || null, due, parseFloat(total_balance) || 0, paid, date_paid || null, status, notes || '');
  res.json(db.prepare('SELECT bp.*, b.name as bill_name FROM bill_payments bp JOIN bills b ON bp.bill_id = b.id WHERE bp.id = ?').get(id));
});

app.delete('/api/bill-payments/:id', (req, res) => {
  db.prepare('DELETE FROM bill_payments WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── API: Get all records ────────────────────────────────────
app.get('/api/records', (req, res) => {
  const records = db.prepare('SELECT * FROM records ORDER BY date DESC').all();
  res.json(records);
});

// ── API: Create / Update record ─────────────────────────────
// Helper: extract EXIF date from an image file
async function getExifDate(filePath) {
  try {
    const exif = await exifr.parse(filePath, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] });
    const dt = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate;
    if (dt instanceof Date) {
      return dt.toISOString().split('T')[0]; // YYYY-MM-DD
    }
  } catch (e) {
    console.log('EXIF extraction skipped:', e.message);
  }
  return null;
}

// Helper: extract odometer reading from an image via AI
async function extractOdometerFromImage(imageFile) {
  if (!ai) return { reading: null, error: 'AI not configured' };
  try {
    const base64 = fs.readFileSync(imageFile.path, 'base64');
    const resp = await ai.chat.completions.create({
      model: VISION_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${imageFile.mimetype};base64,${base64}` } },
          { type: 'text', text: 'Identify the main odometer reading (total mileage) from this dashboard image. It is usually the largest integer number. Ignore trip meters. Return ONLY the numeric value.' }
        ]
      }]
    });
    const text = resp.choices?.[0]?.message?.content?.trim() || '';
    console.log('Odometer AI response:', text);
    const match = text.match(/[\d,]+(\.\d+)?/);
    if (match) return { reading: parseFloat(match[0].replace(/,/g, '')), error: null };
    return { reading: null, error: `AI returned "${text}"` };
  } catch (err) {
    console.error('Odometer extraction error:', err.message);
    return { reading: null, error: err.message };
  }
}

app.post('/api/records',
  upload.fields([
    { name: 'startOdometerImage', maxCount: 1 },
    { name: 'odometerImage', maxCount: 1 },
    { name: 'gasReceiptImage', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const { date, earnings, gasCost, notes, personalMiles, odometerReading, startMiles } = req.body;
      const files = req.files || {};
      const startOdometerImage = files['startOdometerImage']?.[0];
      const odometerImage = files['odometerImage']?.[0];
      const gasReceiptImage = files['gasReceiptImage']?.[0];

      let extractedStartMiles = null;
      let extractedEndMiles = null;
      let extractedGasCost = null;
      let extractionError = null;

      // ── Extract EXIF date from photos ─────────────────────
      let exifDate = null;
      if (startOdometerImage) exifDate = await getExifDate(startOdometerImage.path);
      if (!exifDate && odometerImage) exifDate = await getExifDate(odometerImage.path);
      if (!exifDate && gasReceiptImage) exifDate = await getExifDate(gasReceiptImage.path);

      // ── Extract start odometer from image ─────────────────
      if (startOdometerImage && ai) {
        const result = await extractOdometerFromImage(startOdometerImage);
        if (result.reading !== null) extractedStartMiles = result.reading;
        else if (result.error) extractionError = `Start odometer: ${result.error}`;
      }

      // ── Extract end odometer from image ───────────────────
      if (odometerImage && ai) {
        const result = await extractOdometerFromImage(odometerImage);
        if (result.reading !== null) extractedEndMiles = result.reading;
        else if (result.error) {
          const msg = `End odometer: ${result.error}`;
          extractionError = extractionError ? extractionError + '; ' + msg : msg;
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
            const amountMatch = text.match(/\$?\s*(\d+\.\d{2})/);
            if (amountMatch) extractedGasCost = parseFloat(amountMatch[1]);
          }
        } catch (err) {
          console.error('Receipt extraction error:', err.message);
        }
      }

      // ── Determine final values ────────────────────────────
      const finalDate = extractedDate || exifDate || date;
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
      const hasStartMiles = startMiles !== undefined && startMiles !== '';
      const hasPersonalMiles = personalMiles !== undefined && personalMiles !== '';

      const finalEarnings = hasEarnings ? parseFloat(earnings) : (existing?.earnings || 0);

      // Auto-calculate personal miles: gap between previous record's end miles and this record's start miles
      // Personal miles are attributed to the PREVIOUS day (driven after that day's work ended)
      let finalPersonalMiles = hasPersonalMiles ? parseFloat(personalMiles) : (existing?.personal_miles || 0);
      if (!hasPersonalMiles) {
        const thisStart = hasStartMiles ? parseFloat(startMiles) : (extractedStartMiles !== null ? extractedStartMiles : (existing?.start_miles || null));
        if (thisStart !== null) {
          const prev = db.prepare('SELECT id, odometer_reading, personal_miles FROM records WHERE date < ? AND odometer_reading IS NOT NULL ORDER BY date DESC LIMIT 1').get(finalDate);
          if (prev && prev.odometer_reading) {
            const gap = thisStart - prev.odometer_reading;
            if (gap > 0) {
              // Update the previous record's personal miles
              db.prepare('UPDATE records SET personal_miles = ? WHERE id = ?').run(gap, prev.id);
            }
          }
        }
      }

      let finalGasCost = existing?.gas_cost || 0;
      if (hasGasCost) finalGasCost = parseFloat(gasCost);
      else if (extractedGasCost !== null) finalGasCost = extractedGasCost;

      // Start miles: manual > AI-extracted > existing
      let finalStartMiles = existing?.start_miles || null;
      if (hasStartMiles) finalStartMiles = parseFloat(startMiles);
      else if (extractedStartMiles !== null) finalStartMiles = extractedStartMiles;

      // End miles (odometer_reading): manual > AI-extracted > existing
      let finalOdometer = existing?.odometer_reading || null;
      if (hasOdometer) finalOdometer = parseFloat(odometerReading);
      else if (extractedEndMiles !== null) finalOdometer = extractedEndMiles;

      const startImagePath = startOdometerImage ? `/uploads/${startOdometerImage.filename}` : (existing?.start_image_path || null);
      const odometerImagePath = odometerImage ? `/uploads/${odometerImage.filename}` : (existing?.odometer_image_path || null);
      const gasReceiptImagePath = gasReceiptImage ? `/uploads/${gasReceiptImage.filename}` : (existing?.gas_receipt_image_path || null);

      const newNotes = notes || '';
      const finalNotes = existing?.notes ? (existing.notes + (newNotes ? '\n' + newNotes : '')) : newNotes;

      if (existing) {
        db.prepare(`
          UPDATE records SET start_miles=?, start_image_path=?, odometer_reading=?, odometer_image_path=?, earnings=?, gas_cost=?, gas_receipt_image_path=?, notes=?, personal_miles=? WHERE id=?
        `).run(finalStartMiles, startImagePath, finalOdometer, odometerImagePath, finalEarnings, finalGasCost, gasReceiptImagePath, finalNotes, finalPersonalMiles, id);
      } else {
        db.prepare(`
          INSERT INTO records (id, date, start_miles, start_image_path, odometer_reading, odometer_image_path, earnings, gas_cost, gas_receipt_image_path, notes, notion_page_id, personal_miles)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, finalDate, finalStartMiles, startImagePath, finalOdometer, odometerImagePath, finalEarnings, finalGasCost, gasReceiptImagePath, finalNotes, null, finalPersonalMiles);
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

          const drivenMiles = (finalStartMiles && finalOdometer) ? finalOdometer - finalStartMiles : null;

          const properties = {
            'Record': { title: [{ text: { content: `Trip on ${finalDate}` } }] },
            'Date': { date: { start: finalDate } },
            'Earnings': { number: finalEarnings },
            'Gas': { number: finalGasCost || 0 },
            'Notes': { rich_text: [{ text: { content: finalNotes || '' } }] },
          };

          if (finalStartMiles !== null) properties['Start Miles'] = { number: finalStartMiles };
          if (finalOdometer !== null) properties['End Miles'] = { number: finalOdometer };
          // Driven Miles is calculated (End - Start), skip syncing to avoid Notion property errors

          if (startImagePath) {
            properties['Start Image'] = { url: `${appUrl}${startImagePath}` };
          }
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

// ── API: Extract receipt for Transactions tab ───────────────
app.post('/api/extract-receipt',
  upload.single('receiptImage'),
  async (req, res) => {
    if (!ai) return res.status(400).json({ error: 'AI not configured' });
    if (!req.file) return res.status(400).json({ error: 'No image provided' });

    try {
      const base64 = fs.readFileSync(req.file.path, 'base64');
      const resp = await ai.chat.completions.create({
        model: VISION_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${req.file.mimetype};base64,${base64}` } },
            { type: 'text', text: `Analyze this receipt image. Extract:
1. Store/business name
2. Total amount paid (number)
3. Date of purchase (YYYY-MM-DD format)
4. Best matching expense category from this list: Food & Dining, Transportation, Housing, Utilities, Entertainment, Shopping, Healthcare, Education, Personal Care, Travel, Subscriptions, Interest & Fees, Other

Return a raw JSON object with keys: "storeName" (string), "amount" (number), "date" (string YYYY-MM-DD), "category" (string from the list above). No markdown, no explanation.` }
          ]
        }]
      });

      let text = resp.choices?.[0]?.message?.content?.trim() || '';
      console.log('Receipt extract AI response:', text);
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        // Also try EXIF date as fallback
        if (!data.date) {
          const exifDate = await getExifDate(req.file.path);
          if (exifDate) data.date = exifDate;
        }
        const receiptImagePath = `/uploads/${req.file.filename}`;
        res.json({ success: true, ...data, receiptImagePath });
      } else {
        const receiptImagePath = `/uploads/${req.file.filename}`;
        res.json({ success: false, error: 'Could not parse receipt data', receiptImagePath });
      }
      // File is kept for receipt gallery
    } catch (error) {
      console.error('Receipt extraction error:', error);
      fs.unlink(req.file.path, () => {});
      res.status(500).json({ error: 'Failed to extract receipt data' });
    }
  }
);

// ── API: Extract credit card statement ──────────────────────
const STATEMENT_PROMPT = `Analyze this credit card statement. Extract ALL individual transactions/line items, INCLUDING interest charges, fees, and finance charges.
For each transaction, determine:
1. Date (YYYY-MM-DD format)
2. Description/merchant name
3. Amount (positive number)
4. Whether it's a charge (expense) or payment/credit (income)
5. Best matching category from: Food & Dining, Transportation, Housing, Utilities, Entertainment, Shopping, Healthcare, Education, Personal Care, Travel, Subscriptions, Interest & Fees, Other

IMPORTANT: Interest charges, finance charges, late fees, annual fees, and similar bank fees should be categorized as "Interest & Fees".

Return a raw JSON array of objects with keys: "date" (string), "description" (string), "amount" (number), "type" ("expense" or "income"), "category" (string from list above).
No markdown, no explanation, just the JSON array.`;

app.post('/api/extract-statement',
  upload.single('statementFile'),
  async (req, res) => {
    if (!ai) return res.status(400).json({ error: 'AI not configured' });
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    try {
      const isPdf = req.file.mimetype === 'application/pdf' ||
                     req.file.originalname.toLowerCase().endsWith('.pdf');
      let aiMessages;

      if (isPdf) {
        // Extract text from PDF and send as text prompt
        const buffer = fs.readFileSync(req.file.path);
        const pdfData = await pdfParse(buffer);
        const text = pdfData.text;
        console.log('PDF text length:', text.length);

        aiMessages = [{
          role: 'user',
          content: STATEMENT_PROMPT + '\n\nStatement text:\n' + text.substring(0, 15000)
        }];
      } else {
        // Image: use vision
        const base64 = fs.readFileSync(req.file.path, 'base64');
        aiMessages = [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${req.file.mimetype};base64,${base64}` } },
            { type: 'text', text: STATEMENT_PROMPT }
          ]
        }];
      }

      const resp = await ai.chat.completions.create({
        model: VISION_MODEL,
        messages: aiMessages
      });

      let text = resp.choices?.[0]?.message?.content?.trim() || '';
      console.log('Statement AI response length:', text.length);
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();

      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const items = JSON.parse(jsonMatch[0]);
        res.json({ success: true, transactions: items });
      } else {
        res.json({ success: false, error: 'Could not parse statement data' });
      }

      fs.unlink(req.file.path, () => {});
    } catch (error) {
      console.error('Statement extraction error:', error);
      fs.unlink(req.file.path, () => {});
      res.status(500).json({ error: 'Failed to extract statement: ' + error.message });
    }
  }
);

// ── API: Receipts gallery ────────────────────────────────────
app.get('/api/receipts', (req, res) => {
  const receipts = [];

  // Uber record images
  const records = db.prepare('SELECT date, start_image_path, odometer_image_path, gas_receipt_image_path FROM records ORDER BY date DESC').all();
  records.forEach(r => {
    if (r.start_image_path) receipts.push({ date: r.date, source: 'Uber', type: 'Start Odometer', path: r.start_image_path, description: 'Start odometer' });
    if (r.odometer_image_path) receipts.push({ date: r.date, source: 'Uber', type: 'End Odometer', path: r.odometer_image_path, description: 'End odometer' });
    if (r.gas_receipt_image_path) receipts.push({ date: r.date, source: 'Uber', type: 'Gas Receipt', path: r.gas_receipt_image_path, description: 'Gas receipt' });
  });

  // Transaction receipt images
  const txs = db.prepare('SELECT date, receipt_image_path, description, category, business FROM transactions WHERE receipt_image_path IS NOT NULL ORDER BY date DESC').all();
  txs.forEach(t => {
    if (t.receipt_image_path) {
      receipts.push({ date: t.date, source: t.business || 'Personal', type: 'Receipt', path: t.receipt_image_path, description: t.description || t.category });
    }
  });

  receipts.sort((a, b) => b.date.localeCompare(a.date));
  res.json(receipts);
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

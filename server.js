const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { Server } = require('socket.io');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

const PORT = process.env.PORT || 3000;
const isVercel = process.env.VERCEL === '1' || Boolean(process.env.NOW_REGION);
const DATA_DIR = isVercel ? path.join('/tmp', 'data') : path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = isVercel ? path.join('/tmp', 'uploads') : path.join(__dirname, 'public', 'uploads');

// Ensure directories exist
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
} catch (e) {
  console.warn('Directory creation warning:', e);
}

let inMemoryDb = { questions: [], answers: [] };

// Database helper
function getDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed.questions) parsed.questions = [];
      if (!parsed.answers) parsed.answers = [];
      inMemoryDb = parsed;
      return inMemoryDb;
    }
  } catch (err) {
    console.warn('Error reading db.json:', err.message);
  }
  return inMemoryDb;
}

function saveDb(data) {
  inMemoryDb = data;
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn('Error saving db.json:', err.message);
  }
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${Date.now()}-${uuidv4().substring(0, 8)}${ext || '.png'}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }
});

// Helper: Save Base64 Image
function saveBase64Image(base64Data) {
  const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  let buffer;
  let ext = '.png';

  if (matches && matches.length === 3) {
    const mime = matches[1];
    if (mime.includes('jpeg') || mime.includes('jpg')) ext = '.jpg';
    else if (mime.includes('webp')) ext = '.webp';
    else if (mime.includes('gif')) ext = '.gif';
    buffer = Buffer.from(matches[2], 'base64');
  } else {
    buffer = Buffer.from(base64Data, 'base64');
  }

  const uniqueName = `${Date.now()}-${uuidv4().substring(0, 8)}${ext}`;
  const filePath = path.join(UPLOAD_DIR, uniqueName);
  try {
    fs.writeFileSync(filePath, buffer);
  } catch (e) {
    console.warn('Could not write image to disk:', e.message);
  }

  return `/uploads/${uniqueName}`;
}

// Helper: Get LAN IP addresses
function getLocalNetworkIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

// Socket.IO handler
io.on('connection', (socket) => {
  socket.on('disconnect', () => {});
});

// --- REST API ENDPOINTS ---

// 1. Get all questions and answers
app.get('/api/feed', (req, res) => {
  const db = getDb();
  res.json({
    success: true,
    questions: db.questions || [],
    answers: db.answers || []
  });
});

// Backwards compatibility endpoint
app.get('/api/questions', (req, res) => {
  const db = getDb();
  res.json({
    success: true,
    questions: db.questions || [],
    answers: db.answers || []
  });
});

// 2. Upload Question Image (Multipart or Base64)
app.post('/api/upload-question', upload.single('file'), (req, res) => {
  try {
    let imageUrl = '';

    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    } else if (req.body.base64Data) {
      imageUrl = saveBase64Image(req.body.base64Data);
    } else if (req.body.imageUrl) {
      imageUrl = req.body.imageUrl;
    } else {
      return res.status(400).json({ error: 'No image provided' });
    }

    const db = getDb();
    const newQuestion = {
      id: uuidv4(),
      number: (db.questions || []).length + 1,
      imageUrl,
      createdAt: new Date().toISOString(),
      type: 'question'
    };

    if (!db.questions) db.questions = [];
    db.questions.unshift(newQuestion);
    saveDb(db);

    io.emit('new_question_image', newQuestion);
    res.json({ success: true, item: newQuestion });
  } catch (err) {
    console.error('Error uploading question image:', err);
    res.status(500).json({ error: 'Failed to upload question image' });
  }
});

// 3. Upload Answer Image (Multipart or Base64)
app.post('/api/upload-answer', upload.single('file'), (req, res) => {
  try {
    let imageUrl = '';

    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    } else if (req.body.base64Data) {
      imageUrl = saveBase64Image(req.body.base64Data);
    } else if (req.body.imageUrl) {
      imageUrl = req.body.imageUrl;
    } else {
      return res.status(400).json({ error: 'No image provided' });
    }

    const db = getDb();
    const newAnswer = {
      id: uuidv4(),
      number: (db.answers || []).length + 1,
      imageUrl,
      createdAt: new Date().toISOString(),
      type: 'answer'
    };

    if (!db.answers) db.answers = [];
    db.answers.unshift(newAnswer);
    saveDb(db);

    io.emit('new_answer_image', newAnswer);
    res.json({ success: true, item: newAnswer });
  } catch (err) {
    console.error('Error uploading answer image:', err);
    res.status(500).json({ error: 'Failed to upload answer image' });
  }
});

// 4. Delete Question or Answer Image
app.delete('/api/item/:type/:id', (req, res) => {
  const { type, id } = req.params;
  const db = getDb();

  if (type === 'question' && db.questions) {
    db.questions = db.questions.filter((item) => item.id !== id);
  } else if (type === 'answer' && db.answers) {
    db.answers = db.answers.filter((item) => item.id !== id);
  }

  saveDb(db);
  io.emit('item_deleted', { type, id });
  res.json({ success: true });
});

// 5. Clear all
app.post('/api/clear', (req, res) => {
  const db = { questions: [], answers: [] };
  saveDb(db);
  io.emit('all_cleared');
  res.json({ success: true });
});

// Serve frontend
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server locally
if (require.main === module && !isVercel && process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => {
    const ips = getLocalNetworkIps();
    console.log(`===================================================`);
    console.log(`🚀 Lab Exam Live Q&A Portal is Running!`);
    console.log(`📍 Local:            http://localhost:${PORT}`);
    ips.forEach((ip) => {
      console.log(`🌐 Network (Share):  http://${ip}:${PORT}`);
    });
    console.log(`===================================================`);
  });
}

module.exports = app;
module.exports.server = server;
module.exports.io = io;

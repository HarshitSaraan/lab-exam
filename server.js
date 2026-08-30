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

let inMemoryDb = { questions: [] };

// Database helper
function getDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      inMemoryDb = JSON.parse(raw);
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
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB max
});

// Helper: Get local IP addresses for easy LAN sharing
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

// Track active connections
const activeRoles = {
  friend: new Set(),
  solver: new Set(),
  dashboard: new Set()
};

function broadcastUserStats() {
  const stats = {
    friendCount: activeRoles.friend.size,
    solverCount: activeRoles.solver.size,
    dashboardCount: activeRoles.dashboard.size,
    totalOnline: activeRoles.friend.size + activeRoles.solver.size + activeRoles.dashboard.size
  };
  io.emit('online_stats', stats);
}

// Socket.IO real-time connection handler
io.on('connection', (socket) => {
  let userRole = null;

  socket.on('register_role', (role) => {
    userRole = role;
    if (activeRoles[role]) {
      activeRoles[role].add(socket.id);
    }
    broadcastUserStats();
  });

  socket.on('typing_status', (data) => {
    // data: { role: 'friend' | 'solver', questionId, isTyping: boolean, name: string }
    socket.broadcast.emit('user_typing', data);
  });

  socket.on('quick_chime', (data) => {
    // Send a manual audio ping / alert to the other portal
    socket.broadcast.emit('play_chime', data);
  });

  socket.on('disconnect', () => {
    if (userRole && activeRoles[userRole]) {
      activeRoles[userRole].delete(socket.id);
      broadcastUserStats();
    }
  });
});

// --- REST API ENDPOINTS ---

// Get network and server info
app.get('/api/info', (req, res) => {
  const ips = getLocalNetworkIps();
  res.json({
    port: PORT,
    localIps: ips,
    stats: {
      friendCount: activeRoles.friend.size,
      solverCount: activeRoles.solver.size,
      dashboardCount: activeRoles.dashboard.size
    }
  });
});

// Upload a file (image, screenshot, pdf)
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({
    success: true,
    url: fileUrl,
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size
  });
});

// Upload base64 image (from clipboard paste)
app.post('/api/upload-base64', (req, res) => {
  try {
    const { base64Data, filename } = req.body;
    if (!base64Data) {
      return res.status(400).json({ error: 'No base64 data provided' });
    }

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
    fs.writeFileSync(filePath, buffer);

    const fileUrl = `/uploads/${uniqueName}`;
    res.json({
      success: true,
      url: fileUrl,
      filename: uniqueName
    });
  } catch (err) {
    console.error('Error handling base64 upload:', err);
    res.status(500).json({ error: 'Failed to process base64 upload' });
  }
});

// Get all questions
app.get('/api/questions', (req, res) => {
  const db = getDb();
  res.json({ success: true, questions: db.questions || [] });
});

// Get single question by ID
app.get('/api/questions/:id', (req, res) => {
  const db = getDb();
  const q = db.questions.find((item) => item.id === req.params.id);
  if (!q) {
    return res.status(400).json({ error: 'Question not found' });
  }
  res.json({ success: true, question: q });
});

// Create new question (Friend portal)
app.post('/api/questions', (req, res) => {
  const { title, details, code, language, subject, urgency, attachments } = req.body;

  if (!title && !details && (!attachments || attachments.length === 0)) {
    return res.status(400).json({ error: 'Question must have a title, details, or attachment.' });
  }

  const db = getDb();
  const newQuestion = {
    id: uuidv4(),
    questionNumber: db.questions.length + 1,
    title: title ? title.trim() : `Question #${db.questions.length + 1}`,
    details: details || '',
    code: code || '',
    language: language || 'plaintext',
    subject: subject || 'General',
    urgency: urgency || 'normal', // 'normal' | 'high' | 'urgent'
    attachments: attachments || [], // array of file URLs
    status: 'pending', // 'pending' | 'in_progress' | 'solved'
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    answers: []
  };

  db.questions.unshift(newQuestion);
  saveDb(db);

  // Broadcast real-time event to all connected sockets
  io.emit('new_question', newQuestion);

  res.status(201).json({ success: true, question: newQuestion });
});

// Update question status (e.g. In Progress, Solved, Pending)
app.post('/api/questions/:id/status', (req, res) => {
  const { status, solverName } = req.body;
  const db = getDb();
  const index = db.questions.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Question not found' });
  }

  db.questions[index].status = status;
  db.questions[index].updatedAt = new Date().toISOString();
  if (solverName) {
    db.questions[index].solverName = solverName;
  }

  saveDb(db);

  io.emit('status_updated', {
    questionId: req.params.id,
    status,
    solverName: db.questions[index].solverName || null,
    updatedAt: db.questions[index].updatedAt,
    question: db.questions[index]
  });

  res.json({ success: true, question: db.questions[index] });
});

// Submit / Add Answer to a question (Solver portal)
app.post('/api/questions/:id/answers', (req, res) => {
  const { content, code, language, attachments, author } = req.body;

  if (!content && !code && (!attachments || attachments.length === 0)) {
    return res.status(400).json({ error: 'Answer cannot be empty.' });
  }

  const db = getDb();
  const index = db.questions.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Question not found' });
  }

  const newAnswer = {
    id: uuidv4(),
    content: content || '',
    code: code || '',
    language: language || 'plaintext',
    attachments: attachments || [],
    author: author || 'Solver',
    createdAt: new Date().toISOString()
  };

  db.questions[index].answers.push(newAnswer);
  db.questions[index].status = 'solved';
  db.questions[index].updatedAt = new Date().toISOString();

  saveDb(db);

  // Broadcast real-time answer event to all clients
  io.emit('new_answer', {
    questionId: req.params.id,
    answer: newAnswer,
    question: db.questions[index]
  });

  res.status(201).json({ success: true, answer: newAnswer, question: db.questions[index] });
});

// Delete a question
app.delete('/api/questions/:id', (req, res) => {
  const db = getDb();
  const index = db.questions.findIndex((item) => item.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Question not found' });
  }

  const removed = db.questions.splice(index, 1)[0];
  saveDb(db);

  io.emit('question_deleted', { questionId: req.params.id });
  res.json({ success: true, removed });
});

// Clear all questions and answers (Reset session)
app.post('/api/clear', (req, res) => {
  const db = { questions: [] };
  saveDb(db);

  io.emit('all_cleared');
  res.json({ success: true, message: 'All questions cleared successfully.' });
});

// Specific route handlers to serve HTML pages
app.get('/ask', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ask.html'));
});

app.get('/solve', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'solve.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server (only when run directly via node server.js locally, not in serverless)
if (require.main === module && !isVercel && process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => {
    const ips = getLocalNetworkIps();
    console.log(`===================================================`);
    console.log(`🚀 Lab Exam Live Q&A Portal is Running!`);
    console.log(`📍 Local:            http://localhost:${PORT}`);
    ips.forEach((ip) => {
      console.log(`🌐 Network (Share):  http://${ip}:${PORT}`);
    });
    console.log(`---------------------------------------------------`);
    console.log(`👉 Friend Portal:    http://localhost:${PORT}/ask`);
    console.log(`👉 Solver Portal:    http://localhost:${PORT}/solve`);
    console.log(`👉 Unified Board:    http://localhost:${PORT}/dashboard`);
    console.log(`===================================================`);
  });
}

module.exports = app;
module.exports.server = server;
module.exports.io = io;

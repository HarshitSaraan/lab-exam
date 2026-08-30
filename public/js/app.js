/**
 * 2-Box Live Image Exchange Logic (Questions & Answers)
 */

const socket = io({ transports: ['websocket', 'polling'], timeout: 5000, reconnectionAttempts: 5 });

let questionsData = [];
let answersData = [];
let lastFocusedTarget = 'question'; // 'question' | 'answer'

socket.on('connect_error', () => {
  // Graceful fallback to REST polling on serverless hosting
});

// Real-time events
socket.on('new_question_image', (item) => {
  const exists = questionsData.find(q => q.id === item.id);
  if (!exists) {
    questionsData.unshift(item);
    renderQuestions();
    SoundManager.playQuestionAlert();
    showToast('New question image received!', 'question', 'Question Uploaded');
  }
});

socket.on('new_answer_image', (item) => {
  const exists = answersData.find(a => a.id === item.id);
  if (!exists) {
    answersData.unshift(item);
    renderAnswers();
    SoundManager.playAnswerAlert();
    showToast('New answer image received!', 'answer', 'Answer Uploaded');
    try {
      if (window.confetti) {
        window.confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
      }
    } catch (e) {}
  }
});

socket.on('item_deleted', ({ type, id }) => {
  if (type === 'question') {
    questionsData = questionsData.filter(q => q.id !== id);
    renderQuestions();
  } else if (type === 'answer') {
    answersData = answersData.filter(a => a.id !== id);
    renderAnswers();
  }
});

socket.on('all_cleared', () => {
  questionsData = [];
  answersData = [];
  renderQuestions();
  renderAnswers();
  showToast('All images cleared', 'info');
});

// Polling fallback for Vercel
setInterval(loadFeed, 2500);

// Load Feed from Server
let prevQCount = 0;
let prevACount = 0;

async function loadFeed() {
  try {
    const res = await fetch('/api/feed');
    const data = await res.json();
    if (data.success) {
      // Audio chime on polling detection
      if (prevQCount > 0 && data.questions.length > prevQCount) {
        SoundManager.playQuestionAlert();
        showToast('New question image arrived!', 'question');
      }
      if (prevACount > 0 && data.answers.length > prevACount) {
        SoundManager.playAnswerAlert();
        showToast('New answer image arrived!', 'answer');
      }
      prevQCount = data.questions.length;
      prevACount = data.answers.length;

      const qChanged = JSON.stringify(questionsData) !== JSON.stringify(data.questions);
      if (qChanged) {
        questionsData = data.questions;
        renderQuestions();
      }

      const aChanged = JSON.stringify(answersData) !== JSON.stringify(data.answers);
      if (aChanged) {
        answersData = data.answers;
        renderAnswers();
      }
    }
  } catch (e) {
    // Ignore polling glitches
  }
}

// File input selection
async function handleFileInput(event, targetType) {
  const file = event.target.files[0];
  if (!file) return;
  await uploadImageFile(file, targetType);
  event.target.value = '';
}

// Upload file helper
async function uploadImageFile(file, targetType) {
  showToast(`Uploading ${targetType === 'question' ? 'Question' : 'Answer'} image...`, 'info');
  const formData = new FormData();
  formData.append('file', file);

  try {
    const endpoint = targetType === 'question' ? '/api/upload-question' : '/api/upload-answer';
    const res = await fetch(endpoint, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      showToast(`${targetType === 'question' ? 'Question' : 'Answer'} uploaded live!`, 'success');
      loadFeed();
    } else {
      showToast(data.error || 'Upload failed', 'error');
    }
  } catch (err) {
    showToast('Failed to upload image', 'error');
  }
}

// Upload base64 helper (from Ctrl+V)
async function uploadBase64(base64Data, targetType) {
  showToast(`Uploading pasted ${targetType === 'question' ? 'Question' : 'Answer'}...`, 'info');
  try {
    const endpoint = targetType === 'question' ? '/api/upload-question' : '/api/upload-answer';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Data })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`${targetType === 'question' ? 'Question' : 'Answer'} uploaded live!`, 'success');
      loadFeed();
    } else {
      showToast(data.error || 'Failed to process pasted screenshot', 'error');
    }
  } catch (err) {
    showToast('Error uploading pasted screenshot', 'error');
  }
}

// Delete an item
async function deleteItem(type, id) {
  if (!confirm(`Delete this ${type} image?`)) return;
  try {
    const res = await fetch(`/api/item/${type}/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Image deleted', 'info');
      loadFeed();
    }
  } catch (e) {
    showToast('Failed to delete image', 'error');
  }
}

// Clear all
async function clearAllPrompt() {
  if (confirm('Reset and clear all question and answer images?')) {
    try {
      const res = await fetch('/api/clear', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('All images cleared', 'success');
        loadFeed();
      }
    } catch (e) {
      showToast('Failed to clear', 'error');
    }
  }
}

// Render Questions List
function renderQuestions() {
  const container = document.getElementById('question-images-list');
  const countBadge = document.getElementById('question-count-badge');
  if (countBadge) countBadge.textContent = `${questionsData.length}`;

  if (questionsData.length === 0) {
    container.innerHTML = `
      <div id="question-empty" class="p-8 text-center rounded-xl bg-slate-50 border border-dashed border-slate-200 text-slate-400 text-xs flex flex-col items-center gap-1.5">
        <i class="fa-solid fa-image text-2xl text-slate-300"></i>
        <span>No question images uploaded yet</span>
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  questionsData.forEach((q, idx) => {
    const card = document.createElement('div');
    card.className = 'light-card p-3 rounded-xl bg-white border border-slate-200 shadow-sm flex flex-col gap-2 transition hover:shadow-md';
    card.innerHTML = `
      <div class="flex items-center justify-between text-xs text-slate-500 pb-1.5 border-b border-slate-100">
        <span class="font-bold text-indigo-700 flex items-center gap-1.5">
          <i class="fa-solid fa-circle-question text-indigo-600"></i> Question #${q.number || (questionsData.length - idx)}
        </span>
        <div class="flex items-center gap-2">
          <span>${timeAgo(q.createdAt)}</span>
          <a href="${q.imageUrl}" download class="p-1 text-slate-400 hover:text-indigo-600 transition" title="Download image">
            <i class="fa-solid fa-download"></i>
          </a>
          <button onclick="deleteItem('question', '${q.id}')" class="p-1 text-slate-400 hover:text-rose-600 transition" title="Delete image">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>
      <div class="relative group cursor-pointer overflow-hidden rounded-lg border border-slate-100 bg-slate-50" onclick="openImageModal('${q.imageUrl}')">
        <img src="${q.imageUrl}" alt="Question Image" class="w-full max-h-80 object-contain mx-auto rounded-lg">
        <div class="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 rounded-lg flex items-center justify-center text-white text-xs font-semibold gap-1.5 transition">
          <i class="fa-solid fa-magnifying-glass-plus text-sm"></i> Click to Zoom
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

// Render Answers List
function renderAnswers() {
  const container = document.getElementById('answer-images-list');
  const countBadge = document.getElementById('answer-count-badge');
  if (countBadge) countBadge.textContent = `${answersData.length}`;

  if (answersData.length === 0) {
    container.innerHTML = `
      <div id="answer-empty" class="p-8 text-center rounded-xl bg-slate-50 border border-dashed border-slate-200 text-slate-400 text-xs flex flex-col items-center gap-1.5">
        <i class="fa-solid fa-image text-2xl text-slate-300"></i>
        <span>No answer images uploaded yet</span>
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  answersData.forEach((a, idx) => {
    const card = document.createElement('div');
    card.className = 'light-card p-3 rounded-xl bg-white border border-emerald-200 shadow-sm flex flex-col gap-2 transition hover:shadow-md';
    card.innerHTML = `
      <div class="flex items-center justify-between text-xs text-slate-500 pb-1.5 border-b border-emerald-100">
        <span class="font-bold text-emerald-700 flex items-center gap-1.5">
          <i class="fa-solid fa-lightbulb text-emerald-600"></i> Answer #${a.number || (answersData.length - idx)}
        </span>
        <div class="flex items-center gap-2">
          <span>${timeAgo(a.createdAt)}</span>
          <a href="${a.imageUrl}" download class="p-1 text-slate-400 hover:text-emerald-600 transition" title="Download image">
            <i class="fa-solid fa-download"></i>
          </a>
          <button onclick="deleteItem('answer', '${a.id}')" class="p-1 text-slate-400 hover:text-rose-600 transition" title="Delete image">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>
      <div class="relative group cursor-pointer overflow-hidden rounded-lg border border-emerald-100 bg-emerald-50/30" onclick="openImageModal('${a.imageUrl}')">
        <img src="${a.imageUrl}" alt="Answer Image" class="w-full max-h-80 object-contain mx-auto rounded-lg">
        <div class="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 rounded-lg flex items-center justify-center text-white text-xs font-semibold gap-1.5 transition">
          <i class="fa-solid fa-magnifying-glass-plus text-sm"></i> Click to Zoom
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

// Setup Drag & Drop and Smart Clipboard Paste
document.addEventListener('DOMContentLoaded', () => {
  const qDrop = document.getElementById('question-dropzone');
  const aDrop = document.getElementById('answer-dropzone');
  const qBox = document.getElementById('question-box');
  const aBox = document.getElementById('answer-box');

  // Track active hover box for clipboard paste
  if (qBox) {
    qBox.addEventListener('mouseenter', () => { lastFocusedTarget = 'question'; });
    qBox.addEventListener('click', () => { lastFocusedTarget = 'question'; });
  }
  if (aBox) {
    aBox.addEventListener('mouseenter', () => { lastFocusedTarget = 'answer'; });
    aBox.addEventListener('click', () => { lastFocusedTarget = 'answer'; });
  }

  // Setup drag & drop for Question dropzone
  if (qDrop) {
    qDrop.addEventListener('dragover', (e) => { e.preventDefault(); qDrop.classList.add('dragover'); });
    qDrop.addEventListener('dragleave', () => { qDrop.classList.remove('dragover'); });
    qDrop.addEventListener('drop', async (e) => {
      e.preventDefault();
      qDrop.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files && files[0]) await uploadImageFile(files[0], 'question');
    });
  }

  // Setup drag & drop for Answer dropzone
  if (aDrop) {
    aDrop.addEventListener('dragover', (e) => { e.preventDefault(); aDrop.classList.add('dragover'); });
    aDrop.addEventListener('dragleave', () => { aDrop.classList.remove('dragover'); });
    aDrop.addEventListener('drop', async (e) => {
      e.preventDefault();
      aDrop.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files && files[0]) await uploadImageFile(files[0], 'answer');
    });
  }

  // Global Ctrl+V Paste Handler
  window.addEventListener('paste', async (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = async (event) => {
          const base64Data = event.target.result;
          await uploadBase64(base64Data, lastFocusedTarget);
        };
        reader.readAsDataURL(blob);
      }
    }
  });

  loadFeed();
});

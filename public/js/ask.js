const socket = io({ transports: ['websocket', 'polling'] });
let currentFilter = 'all';
let questionsList = [];
let attachedImages = [];

// Polling interval as a resilient fallback for serverless hosting
setInterval(loadQuestions, 3000);

// Register role
socket.emit('register_role', 'friend');

// Listen for connection stats
socket.on('online_stats', (stats) => {
  const isSolverOnline = stats.solverCount > 0;
  const dot = document.getElementById('solver-status-dot');
  const label = document.getElementById('solver-status-label');
  const pill = document.getElementById('solver-status-pill');

  if (isSolverOnline) {
    dot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
    label.textContent = `Solver: Online (${stats.solverCount})`;
    pill.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 text-xs';
  } else {
    dot.className = 'w-2 h-2 rounded-full bg-slate-500';
    label.textContent = 'Solver: Offline';
    pill.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-xs';
  }
});

// Real-time events
socket.on('new_question', (question) => {
  const existing = questionsList.find(q => q.id === question.id);
  if (!existing) {
    questionsList.unshift(question);
    renderFeed();
  }
});

socket.on('status_updated', (data) => {
  const q = questionsList.find(item => item.id === data.questionId);
  if (q) {
    q.status = data.status;
    q.solverName = data.solverName;
    q.updatedAt = data.updatedAt;
    renderFeed();

    if (data.status === 'in_progress') {
      showToast(`Solver started working on "${q.title}"!`, 'info', 'In Progress');
      SoundManager.playPing();
    }
  }
});

socket.on('new_answer', (data) => {
  const q = questionsList.find(item => item.id === data.questionId);
  if (q) {
    if (!q.answers) q.answers = [];
    q.answers.push(data.answer);
    q.status = 'solved';
    renderFeed();

    // Celebration & Audio alert
    SoundManager.playAnswerAlert();
    showToast(`Answer received for "${q.title}"!`, 'answer', 'Answer Ready!');
    
    try {
      if (window.confetti) {
        window.confetti({
          particleCount: 50,
          spread: 60,
          origin: { y: 0.7 }
        });
      }
    } catch (e) {}
  }
});

socket.on('question_deleted', (data) => {
  questionsList = questionsList.filter(item => item.id !== data.questionId);
  renderFeed();
});

socket.on('all_cleared', () => {
  questionsList = [];
  renderFeed();
  showToast('All questions have been cleared.', 'info');
});

// Typing indicator from solver
let typingTimeout = null;
socket.on('user_typing', (data) => {
  if (data.role === 'solver') {
    const indicator = document.getElementById('typing-indicator-bar');
    const typingText = document.getElementById('typing-text');
    
    if (data.isTyping) {
      typingText.textContent = `${data.name || 'Solver'} is drafting an answer...`;
      indicator.classList.remove('hidden');
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        indicator.classList.add('hidden');
      }, 3000);
    } else {
      indicator.classList.add('hidden');
    }
  }
});

// Initial & Polling Data Fetch
let previousTotalAnswersCount = 0;
async function loadQuestions() {
  try {
    const res = await fetch('/api/questions');
    const data = await res.json();
    if (data.success) {
      const newAnswersCount = data.questions.reduce((acc, q) => acc + (q.answers ? q.answers.length : 0), 0);
      if (previousTotalAnswersCount > 0 && newAnswersCount > previousTotalAnswersCount) {
        SoundManager.playAnswerAlert();
        showToast('New answer received from solver!', 'answer', 'Answer Ready!');
      }
      previousTotalAnswersCount = newAnswersCount;

      const hasChanged = JSON.stringify(questionsList) !== JSON.stringify(data.questions);
      if (hasChanged) {
        questionsList = data.questions;
        renderFeed();
      }
    }
  } catch (err) {
    // Silently ignore network hiccups in polling
  }
}

// Toggle Starter Code Box
function toggleCodeBox() {
  const box = document.getElementById('code-box-container');
  const icon = document.getElementById('code-toggle-icon');
  const isHidden = box.classList.toggle('hidden');
  icon.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(180deg)';
}

// Handle Form Submission
async function handleQuestionSubmit(event) {
  event.preventDefault();

  const title = document.getElementById('q-title').value.trim();
  const details = document.getElementById('q-details').value.trim();
  const subject = document.getElementById('q-subject').value;
  const urgency = document.getElementById('q-urgency').value;
  const code = document.getElementById('q-code').value;
  const language = document.getElementById('q-code-lang').value;
  const submitBtn = document.getElementById('submit-question-btn');

  if (!title && !details && attachedImages.length === 0) {
    showToast('Please enter a title, description, or attach an image.', 'warning');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Broadcasting to Solver...`;

  try {
    const payload = {
      title,
      details,
      subject,
      urgency,
      code,
      language,
      attachments: attachedImages
    };

    const res = await fetch('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      showToast('Question broadcasted live to solver!', 'success');
      // Reset form
      document.getElementById('question-form').reset();
      attachedImages = [];
      renderAttachmentsPreview();
      const codeBox = document.getElementById('code-box-container');
      if (!codeBox.classList.contains('hidden')) {
        toggleCodeBox();
      }
    } else {
      showToast(data.error || 'Failed to submit question', 'error');
    }
  } catch (err) {
    showToast('Network error while posting question', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Send Question to Solver Live`;
  }
}

// Handle image upload from file picker
async function handleFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;
  await uploadSingleFile(file, (url) => {
    attachedImages.push(url);
    renderAttachmentsPreview();
  });
  event.target.value = '';
}

// Render image preview thumbnails
function renderAttachmentsPreview() {
  const container = document.getElementById('q-attachments-preview');
  container.innerHTML = '';

  attachedImages.forEach((url, idx) => {
    const item = document.createElement('div');
    item.className = 'img-preview-card border border-slate-700 bg-slate-900 rounded-lg p-1 relative group';
    item.innerHTML = `
      <img src="${url}" class="w-full h-16 object-cover rounded cursor-pointer" onclick="openImageModal('${url}')">
      <button type="button" onclick="removeAttachment(${idx})" class="remove-btn absolute top-1 right-1 w-5 h-5 bg-rose-600 hover:bg-rose-500 text-white rounded-full flex items-center justify-center text-[10px] shadow">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;
    container.appendChild(item);
  });
}

function removeAttachment(index) {
  attachedImages.splice(index, 1);
  renderAttachmentsPreview();
}

// Filter switching
function setFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('.filter-tab-btn').forEach(btn => {
    btn.classList.remove('active', 'bg-indigo-600', 'text-white');
    btn.classList.add('bg-slate-800', 'text-slate-300');
  });
  event.target.classList.add('active', 'bg-indigo-600', 'text-white');
  event.target.classList.remove('bg-slate-800', 'text-slate-300');
  renderFeed();
}

// Delete question
async function deleteQuestion(id) {
  if (!confirm('Delete this question?')) return;
  try {
    const res = await fetch(`/api/questions/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Question deleted', 'info');
    }
  } catch (e) {
    showToast('Failed to delete question', 'error');
  }
}

// Render Live Questions Feed
function renderFeed() {
  const feed = document.getElementById('questions-feed');
  const countBadge = document.getElementById('question-count-badge');
  
  let filtered = questionsList;
  if (currentFilter === 'pending') {
    filtered = questionsList.filter(q => q.status === 'pending' || q.status === 'in_progress');
  } else if (currentFilter === 'solved') {
    filtered = questionsList.filter(q => q.status === 'solved');
  }

  countBadge.textContent = `${questionsList.length} Questions`;

  if (filtered.length === 0) {
    feed.innerHTML = `
      <div class="p-12 text-center rounded-2xl glass-panel border border-slate-800 flex flex-col items-center justify-center gap-3">
        <div class="w-14 h-14 rounded-2xl bg-slate-800/80 flex items-center justify-center text-slate-500 text-xl">
          <i class="fa-solid fa-inbox"></i>
        </div>
        <div class="text-sm font-bold text-white">No questions in "${currentFilter}" filter</div>
        <p class="text-xs text-slate-400">Post a question or switch filters to view more.</p>
      </div>
    `;
    return;
  }

  feed.innerHTML = '';

  filtered.forEach((q) => {
    const card = document.createElement('div');
    card.id = `q-card-${q.id}`;
    card.className = 'glass-panel p-5 rounded-2xl border border-slate-800/80 transition-all duration-300 relative';

    // Urgency pill
    const urgencyBadge = {
      urgent: '<span class="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold"><i class="fa-solid fa-fire text-rose-400 mr-1"></i>URGENT</span>',
      high: '<span class="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold"><i class="fa-solid fa-bolt text-amber-400 mr-1"></i>HIGH</span>',
      normal: '<span class="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 text-[10px] font-medium">Normal</span>'
    }[q.urgency] || '';

    // Status pill
    let statusPill = '';
    if (q.status === 'pending') {
      statusPill = `
        <span class="px-2.5 py-1 rounded-full bg-amber-950/60 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-1.5">
          <i class="fa-solid fa-hourglass-start animate-spin"></i> Waiting for Solver
        </span>
      `;
    } else if (q.status === 'in_progress') {
      statusPill = `
        <span class="px-2.5 py-1 rounded-full bg-indigo-950/80 text-indigo-300 border border-indigo-500/40 text-xs font-semibold flex items-center gap-1.5 animate-pulse">
          <i class="fa-solid fa-bolt text-indigo-400"></i> Solver Working On It...
        </span>
      `;
    } else if (q.status === 'solved') {
      statusPill = `
        <span class="px-2.5 py-1 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 text-xs font-semibold flex items-center gap-1.5">
          <i class="fa-solid fa-circle-check text-emerald-400"></i> Solved!
        </span>
      `;
    }

    // Attachments HTML
    let attachmentsHtml = '';
    if (q.attachments && q.attachments.length > 0) {
      attachmentsHtml = `
        <div class="mt-3 flex flex-wrap gap-2">
          ${q.attachments.map(url => `
            <div class="group relative cursor-pointer" onclick="openImageModal('${url}')">
              <img src="${url}" class="w-20 h-20 object-cover rounded-lg border border-slate-700 hover:border-indigo-500 transition shadow">
              <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 rounded-lg flex items-center justify-center text-white text-xs transition">
                <i class="fa-solid fa-magnifying-glass-plus"></i>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    // Code snippet HTML
    let codeHtml = '';
    if (q.code) {
      codeHtml = `
        <div class="mt-3 relative">
          <div class="flex items-center justify-between text-[11px] bg-slate-900 px-3 py-1.5 rounded-t-lg border-t border-x border-slate-800 text-slate-400 font-mono">
            <span>${q.language || 'Code'}</span>
            <button onclick="copyToClipboard(decodeURIComponent('${encodeURIComponent(q.code)}'), this)" class="hover:text-white transition flex items-center gap-1">
              <i class="fa-solid fa-copy"></i> Copy
            </button>
          </div>
          <pre class="rounded-b-lg border-b border-x border-slate-800 !mt-0 !text-xs"><code class="language-${q.language || 'plaintext'}">${escapeHtml(q.code)}</code></pre>
        </div>
      `;
    }

    // Answers Section HTML
    let answersHtml = '';
    if (q.answers && q.answers.length > 0) {
      answersHtml = `
        <div class="mt-5 pt-4 border-t border-slate-800/80 space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
              <i class="fa-solid fa-lightbulb"></i> Solutions from Solver (${q.answers.length})
            </span>
          </div>

          ${q.answers.map((ans, aIdx) => `
            <div class="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/20 text-slate-200 text-xs sm:text-sm space-y-3">
              <div class="flex items-center justify-between text-xs text-slate-400 pb-2 border-b border-emerald-900/30">
                <span class="font-semibold text-emerald-300 flex items-center gap-1.5">
                  <i class="fa-solid fa-user-check"></i> ${ans.author || 'Solver'}
                </span>
                <div class="flex items-center gap-2">
                  <span>${timeAgo(ans.createdAt)}</span>
                  <button 
                    onclick="copyToClipboard(decodeURIComponent('${encodeURIComponent((ans.content || '') + (ans.code ? '\n\n' + ans.code : ''))}'), this)" 
                    class="px-2 py-0.5 rounded bg-emerald-900/40 hover:bg-emerald-800/60 text-emerald-300 text-[11px] border border-emerald-700/40 flex items-center gap-1 transition"
                  >
                    <i class="fa-solid fa-copy"></i> Copy Solution
                  </button>
                </div>
              </div>

              ${ans.content ? `<div class="prose prose-invert max-w-none text-xs sm:text-sm leading-relaxed">${renderContent(ans.content)}</div>` : ''}

              ${ans.code ? `
                <div class="relative mt-2">
                  <div class="flex items-center justify-between text-[11px] bg-slate-900 px-3 py-1.5 rounded-t-lg border-t border-x border-slate-800 text-slate-400 font-mono">
                    <span>${ans.language || 'Code Solution'}</span>
                    <button onclick="copyToClipboard(decodeURIComponent('${encodeURIComponent(ans.code)}'), this)" class="hover:text-white transition flex items-center gap-1">
                      <i class="fa-solid fa-copy"></i> Copy Code
                    </button>
                  </div>
                  <pre class="rounded-b-lg border-b border-x border-slate-800 !mt-0 !text-xs"><code class="language-${ans.language || 'plaintext'}">${escapeHtml(ans.code)}</code></pre>
                </div>
              ` : ''}

              ${ans.attachments && ans.attachments.length > 0 ? `
                <div class="mt-2 flex flex-wrap gap-2">
                  ${ans.attachments.map(img => `
                    <img src="${img}" class="w-20 h-20 object-cover rounded-lg border border-emerald-800/50 cursor-pointer hover:border-emerald-400 transition" onclick="openImageModal('${img}')">
                  `).join('')}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      `;
    }

    card.innerHTML = `
      <!-- Header -->
      <div class="flex items-start justify-between gap-2">
        <div>
          <div class="flex items-center gap-2 mb-1.5">
            <span class="text-xs font-mono font-bold text-indigo-400">#${q.questionNumber || '1'}</span>
            <span class="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-[10px] font-medium">${q.subject || 'General'}</span>
            ${urgencyBadge}
          </div>
          <h4 class="text-base font-bold text-white tracking-tight">${escapeHtml(q.title)}</h4>
        </div>
        <div class="flex items-center gap-2">
          ${statusPill}
          <button onclick="deleteQuestion('${q.id}')" class="text-slate-500 hover:text-rose-400 text-xs p-1 transition" title="Delete question">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>

      <!-- Problem statement -->
      ${q.details ? `<div class="mt-3 text-xs sm:text-sm text-slate-300 leading-relaxed">${renderContent(q.details)}</div>` : ''}

      <!-- Attachments & Code -->
      ${attachmentsHtml}
      ${codeHtml}

      <!-- Time & meta footer -->
      <div class="mt-3 pt-2 text-[11px] text-slate-500 flex items-center justify-between">
        <span>Uploaded ${timeAgo(q.createdAt)}</span>
        <span>${formatExactTime(q.createdAt)}</span>
      </div>

      <!-- Answers Area -->
      ${answersHtml}
    `;

    feed.appendChild(card);
  });

  // Re-run Prism highlighting
  if (window.Prism) {
    window.Prism.highlightAll();
  }
}

// Setup Drag & Drop and Clipboard Paste for questions
document.addEventListener('DOMContentLoaded', () => {
  const dropzone = document.getElementById('question-dropzone');
  setupImagePasteAndDrop(dropzone, (url) => {
    attachedImages.push(url);
    renderAttachmentsPreview();
  });

  loadQuestions();
});

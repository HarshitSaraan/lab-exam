const socket = io({ transports: ['websocket', 'polling'] });
let currentFilter = 'all';
let questionsList = [];
let activeSolvingQuestionId = null;
let ansAttachments = [];
let typingDebounceTimer = null;

// Polling interval as a resilient fallback for serverless hosting
setInterval(loadSolverQuestions, 3000);

// Register role
socket.emit('register_role', 'solver');

// Name persistence
const nameInput = document.getElementById('solver-name-input');
const savedName = localStorage.getItem('solver_name');
if (savedName) {
  nameInput.value = savedName;
}
nameInput.addEventListener('input', () => {
  localStorage.setItem('solver_name', nameInput.value.trim());
});

function getSolverName() {
  return nameInput.value.trim() || 'Solver';
}

// Online stats
socket.on('online_stats', (stats) => {
  const isFriendOnline = stats.friendCount > 0;
  const dot = document.getElementById('friend-status-dot');
  const label = document.getElementById('friend-status-label');
  const pill = document.getElementById('friend-status-pill');

  if (isFriendOnline) {
    dot.className = 'w-2 h-2 rounded-full bg-indigo-400 animate-pulse';
    label.textContent = `Friend: Online (${stats.friendCount})`;
    pill.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-950/60 border border-indigo-500/30 text-indigo-300 text-xs';
  } else {
    dot.className = 'w-2 h-2 rounded-full bg-slate-500';
    label.textContent = 'Friend: Offline';
    pill.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-xs';
  }
});

// Real-time events
socket.on('new_question', (question) => {
  const existing = questionsList.find(q => q.id === question.id);
  if (!existing) {
    questionsList.unshift(question);
    renderSolverFeed();
    
    // Play alert & toast
    SoundManager.playQuestionAlert();
    showToast(`New question: "${question.title}"`, 'question', 'Incoming Question!');
  }
});

socket.on('status_updated', (data) => {
  const q = questionsList.find(item => item.id === data.questionId);
  if (q) {
    q.status = data.status;
    q.solverName = data.solverName;
    q.updatedAt = data.updatedAt;
    renderSolverFeed();
  }
});

socket.on('new_answer', (data) => {
  const q = questionsList.find(item => item.id === data.questionId);
  if (q) {
    if (!q.answers) q.answers = [];
    q.answers.push(data.answer);
    q.status = 'solved';
    renderSolverFeed();
  }
});

socket.on('question_deleted', (data) => {
  questionsList = questionsList.filter(item => item.id !== data.questionId);
  renderSolverFeed();
});

socket.on('all_cleared', () => {
  questionsList = [];
  renderSolverFeed();
  showToast('All questions cleared', 'info');
});

// Load Initial & Polling Data
let previousQuestionCount = 0;
async function loadSolverQuestions() {
  try {
    const res = await fetch('/api/questions');
    const data = await res.json();
    if (data.success) {
      if (previousQuestionCount > 0 && data.questions.length > previousQuestionCount) {
        SoundManager.playQuestionAlert();
        showToast('New question detected!', 'question', 'Incoming Question!');
      }
      previousQuestionCount = data.questions.length;

      const hasChanged = JSON.stringify(questionsList) !== JSON.stringify(data.questions);
      if (hasChanged) {
        questionsList = data.questions;
        renderSolverFeed();
      }
    }
  } catch (e) {
    // Silently ignore network glitches during polling
  }
}

// Quick action: Mark In Progress
async function markInProgress(id) {
  try {
    const res = await fetch(`/api/questions/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress', solverName: getSolverName() })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Marked as In Progress. Friend notified!', 'info');
    }
  } catch (e) {
    showToast('Failed to update status', 'error');
  }
}

// Open Answer Modal
function openAnswerModal(id) {
  const q = questionsList.find(item => item.id === id);
  if (!q) return;

  activeSolvingQuestionId = id;
  ansAttachments = [];
  renderAnswerAttachments();

  document.getElementById('modal-q-badge').textContent = `#${q.questionNumber || '1'}`;
  document.getElementById('modal-q-title').textContent = q.title;

  // Render question context preview in modal
  const ref = document.getElementById('modal-q-reference');
  ref.innerHTML = `
    <div class="font-bold text-white mb-1 flex items-center gap-2">
      <span>${escapeHtml(q.title)}</span>
      <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-indigo-300 font-mono">${q.subject}</span>
    </div>
    ${q.details ? `<div class="text-slate-300 line-clamp-3 text-xs mb-2">${renderContent(q.details)}</div>` : ''}
    ${q.attachments && q.attachments.length > 0 ? `
      <div class="flex gap-2">
        ${q.attachments.map(img => `<img src="${img}" class="w-14 h-14 rounded object-cover border border-slate-700 cursor-pointer" onclick="openImageModal('${img}')">`).join('')}
      </div>
    ` : ''}
  `;

  // Pre-set language if question had code
  if (q.language && q.language !== 'plaintext') {
    document.getElementById('ans-code-lang').value = q.language;
  }

  // Clear inputs
  document.getElementById('ans-content').value = '';
  document.getElementById('ans-code').value = '';

  document.getElementById('answer-modal').classList.remove('hidden');

  // Automatically mark as in progress if it was pending
  if (q.status === 'pending') {
    markInProgress(id);
  }
}

function closeAnswerModal() {
  document.getElementById('answer-modal').classList.add('hidden');
  activeSolvingQuestionId = null;
  // Send typing false
  socket.emit('typing_status', { role: 'solver', isTyping: false });
}

// Typing notification
function handleTypingNotification() {
  socket.emit('typing_status', {
    role: 'solver',
    name: getSolverName(),
    isTyping: true,
    questionId: activeSolvingQuestionId
  });

  clearTimeout(typingDebounceTimer);
  typingDebounceTimer = setTimeout(() => {
    socket.emit('typing_status', { role: 'solver', isTyping: false });
  }, 2000);
}

// Attachments for answer
async function handleAnswerFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;
  await uploadSingleFile(file, (url) => {
    ansAttachments.push(url);
    renderAnswerAttachments();
  });
  event.target.value = '';
}

function renderAnswerAttachments() {
  const container = document.getElementById('ans-attachments-preview');
  container.innerHTML = '';

  ansAttachments.forEach((url, idx) => {
    const item = document.createElement('div');
    item.className = 'img-preview-card border border-slate-700 bg-slate-900 rounded-lg p-1 relative group';
    item.innerHTML = `
      <img src="${url}" class="w-full h-16 object-cover rounded cursor-pointer" onclick="openImageModal('${url}')">
      <button type="button" onclick="removeAnsAttachment(${idx})" class="remove-btn absolute top-1 right-1 w-5 h-5 bg-rose-600 hover:bg-rose-500 text-white rounded-full flex items-center justify-center text-[10px] shadow">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;
    container.appendChild(item);
  });
}

function removeAnsAttachment(idx) {
  ansAttachments.splice(idx, 1);
  renderAnswerAttachments();
}

// Submit Answer
async function submitAnswer() {
  if (!activeSolvingQuestionId) return;

  const content = document.getElementById('ans-content').value.trim();
  const code = document.getElementById('ans-code').value;
  const language = document.getElementById('ans-code-lang').value;
  const btn = document.getElementById('post-answer-btn');

  if (!content && !code && ansAttachments.length === 0) {
    showToast('Please provide an explanation, code, or image solution.', 'warning');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Broadcasting...`;

  try {
    const payload = {
      content,
      code,
      language,
      attachments: ansAttachments,
      author: getSolverName()
    };

    const res = await fetch(`/api/questions/${activeSolvingQuestionId}/answers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      showToast('Solution broadcasted to friend successfully!', 'success');
      closeAnswerModal();

      // Audio & Confetti
      SoundManager.playAnswerAlert();
      if (window.confetti) {
        window.confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 } });
      }
    } else {
      showToast(data.error || 'Failed to submit answer', 'error');
    }
  } catch (err) {
    showToast('Network error while posting answer', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Broadcast Answer Live`;
  }
}

// Filter
function setSolverFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('.solver-filter-btn').forEach(btn => {
    if (btn.getAttribute('data-filter') === filter) {
      btn.className = 'solver-filter-btn px-3 py-1 rounded-lg bg-emerald-600 text-white font-semibold';
    } else {
      btn.className = 'solver-filter-btn px-3 py-1 rounded-lg text-slate-400 hover:text-white';
    }
  });
  renderSolverFeed();
}

// Delete question
async function deleteSolverQuestion(id) {
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

// Render Solver Feed
function renderSolverFeed() {
  const feed = document.getElementById('solver-questions-feed');
  const unsolvedBadge = document.getElementById('unsolved-count-text');

  const pendingCount = questionsList.filter(q => q.status === 'pending' || q.status === 'in_progress').length;
  unsolvedBadge.textContent = `${pendingCount} Unsolved`;

  let filtered = questionsList;
  if (currentFilter === 'pending') {
    filtered = questionsList.filter(q => q.status === 'pending');
  } else if (currentFilter === 'in_progress') {
    filtered = questionsList.filter(q => q.status === 'in_progress');
  } else if (currentFilter === 'solved') {
    filtered = questionsList.filter(q => q.status === 'solved');
  }

  if (filtered.length === 0) {
    feed.innerHTML = `
      <div class="p-16 text-center rounded-2xl glass-panel border border-slate-800 flex flex-col items-center justify-center gap-3">
        <div class="w-16 h-16 rounded-2xl bg-slate-800/80 flex items-center justify-center text-slate-500 text-2xl">
          <i class="fa-solid fa-check-double"></i>
        </div>
        <div class="text-base font-bold text-white">No questions in "${currentFilter}" filter</div>
        <p class="text-xs text-slate-400">All caught up or switch filters to view solved questions.</p>
      </div>
    `;
    return;
  }

  feed.innerHTML = '';

  filtered.forEach(q => {
    const card = document.createElement('div');
    card.className = `glass-panel p-6 rounded-2xl border transition-all duration-300 ${
      q.urgency === 'urgent' && q.status !== 'solved'
        ? 'border-rose-500/50 shadow-rose-950/40 shadow-xl'
        : 'border-slate-800'
    }`;

    // Urgency badge
    const urgencyBadge = {
      urgent: '<span class="px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold animate-pulse"><i class="fa-solid fa-fire text-rose-400 mr-1"></i>URGENT</span>',
      high: '<span class="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold"><i class="fa-solid fa-bolt text-amber-400 mr-1"></i>HIGH</span>',
      normal: '<span class="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 text-xs font-medium">Normal</span>'
    }[q.urgency] || '';

    // Status pill
    let statusPill = '';
    if (q.status === 'pending') {
      statusPill = `<span class="px-3 py-1 rounded-full bg-amber-950/60 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-1.5"><i class="fa-solid fa-hourglass-start animate-spin"></i> Pending</span>`;
    } else if (q.status === 'in_progress') {
      statusPill = `<span class="px-3 py-1 rounded-full bg-indigo-950/80 text-indigo-300 border border-indigo-500/40 text-xs font-semibold flex items-center gap-1.5 animate-pulse"><i class="fa-solid fa-bolt text-indigo-400"></i> In Progress (${q.solverName || 'Solver'})</span>`;
    } else if (q.status === 'solved') {
      statusPill = `<span class="px-3 py-1 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 text-xs font-semibold flex items-center gap-1.5"><i class="fa-solid fa-circle-check text-emerald-400"></i> Solved</span>`;
    }

    // Attachments
    let attachmentsHtml = '';
    if (q.attachments && q.attachments.length > 0) {
      attachmentsHtml = `
        <div class="mt-4 p-3 bg-slate-900/60 rounded-xl border border-slate-800">
          <div class="text-[11px] font-semibold text-slate-400 mb-2 flex items-center gap-1.5">
            <i class="fa-solid fa-paperclip text-indigo-400"></i> Question Attachments (${q.attachments.length}) &bull; <span class="text-indigo-300">Click to enlarge</span>
          </div>
          <div class="flex flex-wrap gap-3">
            ${q.attachments.map(url => `
              <div class="group relative cursor-pointer" onclick="openImageModal('${url}')">
                <img src="${url}" class="w-28 h-28 object-cover rounded-lg border border-slate-700 hover:border-indigo-500 transition shadow-md">
                <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 rounded-lg flex items-center justify-center text-white text-sm transition">
                  <i class="fa-solid fa-magnifying-glass-plus"></i>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Starter code
    let codeHtml = '';
    if (q.code) {
      codeHtml = `
        <div class="mt-4 relative">
          <div class="flex items-center justify-between text-xs bg-slate-900 px-3.5 py-2 rounded-t-xl border-t border-x border-slate-800 text-slate-400 font-mono">
            <span>Starter Code (${q.language || 'code'})</span>
            <button onclick="copyToClipboard(decodeURIComponent('${encodeURIComponent(q.code)}'), this)" class="hover:text-white transition flex items-center gap-1.5 text-xs">
              <i class="fa-solid fa-copy"></i> Copy Code
            </button>
          </div>
          <pre class="rounded-b-xl border-b border-x border-slate-800 !mt-0 !text-xs"><code class="language-${q.language || 'plaintext'}">${escapeHtml(q.code)}</code></pre>
        </div>
      `;
    }

    // Existing Answers
    let answersHtml = '';
    if (q.answers && q.answers.length > 0) {
      answersHtml = `
        <div class="mt-6 pt-5 border-t border-slate-800 space-y-4">
          <div class="text-xs font-bold text-emerald-400 flex items-center gap-2">
            <i class="fa-solid fa-circle-check"></i> Published Solutions (${q.answers.length})
          </div>

          ${q.answers.map(ans => `
            <div class="p-4 rounded-xl bg-slate-900/80 border border-emerald-500/30 space-y-3">
              <div class="flex items-center justify-between text-xs text-slate-400 pb-2 border-b border-slate-800">
                <span class="font-semibold text-emerald-300 flex items-center gap-1.5">
                  <i class="fa-solid fa-user-check"></i> ${ans.author || 'Solver'}
                </span>
                <span>${timeAgo(ans.createdAt)}</span>
              </div>
              ${ans.content ? `<div class="text-xs sm:text-sm text-slate-200">${renderContent(ans.content)}</div>` : ''}
              ${ans.code ? `
                <div class="relative mt-2">
                  <div class="flex items-center justify-between text-[11px] bg-slate-950 px-3 py-1 rounded-t-lg border border-slate-800 text-slate-400 font-mono">
                    <span>${ans.language || 'Code'}</span>
                    <button onclick="copyToClipboard(decodeURIComponent('${encodeURIComponent(ans.code)}'), this)" class="hover:text-white transition flex items-center gap-1">
                      <i class="fa-solid fa-copy"></i> Copy
                    </button>
                  </div>
                  <pre class="rounded-b-lg border-b border-x border-slate-800 !mt-0 !text-xs"><code class="language-${ans.language || 'plaintext'}">${escapeHtml(ans.code)}</code></pre>
                </div>
              ` : ''}
              ${ans.attachments && ans.attachments.length > 0 ? `
                <div class="flex flex-wrap gap-2 mt-2">
                  ${ans.attachments.map(img => `
                    <img src="${img}" class="w-20 h-20 object-cover rounded-lg border border-slate-700 cursor-pointer hover:border-emerald-400 transition" onclick="openImageModal('${img}')">
                  `).join('')}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      `;
    }

    card.innerHTML = `
      <!-- Question Top -->
      <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div class="space-y-1.5 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs font-mono font-bold text-emerald-400">#${q.questionNumber || '1'}</span>
            <span class="px-2.5 py-0.5 rounded-md bg-slate-800 text-slate-300 text-xs font-medium">${q.subject || 'General'}</span>
            ${urgencyBadge}
            <span class="text-xs text-slate-500">&bull; ${timeAgo(q.createdAt)}</span>
          </div>
          <h3 class="text-lg font-bold text-white tracking-tight">${escapeHtml(q.title)}</h3>
        </div>

        <div class="flex items-center gap-2 self-start">
          ${statusPill}
          <button onclick="deleteSolverQuestion('${q.id}')" class="text-slate-500 hover:text-rose-400 text-xs p-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 transition" title="Delete question">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>

      <!-- Problem Statement -->
      ${q.details ? `<div class="mt-3.5 text-xs sm:text-sm text-slate-300 leading-relaxed">${renderContent(q.details)}</div>` : ''}

      <!-- Attachments & Starter Code -->
      ${attachmentsHtml}
      ${codeHtml}

      <!-- Action Buttons -->
      <div class="mt-6 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          ${q.status !== 'in_progress' && q.status !== 'solved' ? `
            <button 
              onclick="markInProgress('${q.id}')" 
              class="px-4 py-2 rounded-xl bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 text-xs font-semibold border border-indigo-500/40 flex items-center gap-2 transition"
            >
              <i class="fa-solid fa-bolt text-indigo-400"></i> Mark "Working On It"
            </button>
          ` : ''}
        </div>

        <button 
          onclick="openAnswerModal('${q.id}')" 
          class="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs sm:text-sm shadow-lg shadow-emerald-600/25 flex items-center gap-2 transition hover:-translate-y-0.5"
        >
          <i class="fa-solid fa-pen-fancy"></i> ${q.answers && q.answers.length > 0 ? 'Add Another Answer' : 'Solve This Question'}
        </button>
      </div>

      <!-- Existing solutions -->
      ${answersHtml}
    `;

    feed.appendChild(card);
  });

  // Re-run syntax highlighter
  if (window.Prism) {
    window.Prism.highlightAll();
  }
}

// Setup Drag & Drop and Clipboard Paste for answers modal
document.addEventListener('DOMContentLoaded', () => {
  const dropzone = document.getElementById('ans-dropzone');
  setupImagePasteAndDrop(dropzone, (url) => {
    ansAttachments.push(url);
    renderAnswerAttachments();
  });

  loadSolverQuestions();
});

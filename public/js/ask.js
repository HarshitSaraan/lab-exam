const socket = io({ transports: ['websocket', 'polling'], timeout: 5000, reconnectionAttempts: 5 });
let currentFilter = 'all';
let questionsList = [];
let attachedImages = [];

// Polling interval as a resilient fallback for serverless hosting
setInterval(loadQuestions, 3000);

socket.on('connect_error', () => {
  // Graceful fallback to REST polling on serverless hosting
});

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

  if (countBadge) countBadge.textContent = `${questionsList.length}`;

  if (filtered.length === 0) {
    feed.innerHTML = `
      <div class="light-card p-12 text-center rounded-2xl bg-white flex flex-col items-center justify-center gap-2 border border-dashed border-slate-200">
        <div class="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 text-xl">
          <i class="fa-solid fa-inbox"></i>
        </div>
        <div class="text-sm font-bold text-slate-900">No questions in "${currentFilter}" filter</div>
        <p class="text-xs text-slate-500 max-w-xs">Upload a question on the left to see it appear here.</p>
      </div>
    `;
    return;
  }

  feed.innerHTML = '';

  filtered.forEach((q) => {
    const card = document.createElement('div');
    card.id = `q-card-${q.id}`;
    card.className = 'light-card p-5 rounded-2xl bg-white border border-slate-200 shadow-sm transition-all duration-200 relative';

    // Urgency pill
    const urgencyBadge = {
      urgent: '<span class="px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">URGENT</span>',
      high: '<span class="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">HIGH</span>',
      normal: '<span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-medium">Normal</span>'
    }[q.urgency] || '';

    // Status pill
    let statusPill = '';
    if (q.status === 'pending') {
      statusPill = `
        <span class="px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold flex items-center gap-1.5">
          <i class="fa-solid fa-hourglass-start animate-spin text-[10px]"></i> Waiting
        </span>
      `;
    } else if (q.status === 'in_progress') {
      statusPill = `
        <span class="px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-semibold flex items-center gap-1.5 animate-pulse">
          <i class="fa-solid fa-bolt text-indigo-600 text-[10px]"></i> Solving...
        </span>
      `;
    } else if (q.status === 'solved') {
      statusPill = `
        <span class="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold flex items-center gap-1.5">
          <i class="fa-solid fa-circle-check text-emerald-600 text-[10px]"></i> Solved
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
              <img src="${url}" class="w-20 h-20 object-cover rounded-lg border border-slate-200 hover:border-indigo-500 transition shadow-sm">
              <div class="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 rounded-lg flex items-center justify-center text-white text-xs transition">
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
          <div class="flex items-center justify-between text-[11px] bg-slate-800 text-slate-300 px-3 py-1.5 rounded-t-lg font-mono">
            <span>${q.language || 'Starter Code'}</span>
            <button onclick="copyToClipboard(decodeURIComponent('${encodeURIComponent(q.code)}'), this)" class="hover:text-white transition flex items-center gap-1">
              <i class="fa-solid fa-copy"></i> Copy
            </button>
          </div>
          <pre class="rounded-b-lg border-b border-x border-slate-700 !mt-0 !text-xs"><code class="language-${q.language || 'plaintext'}">${escapeHtml(q.code)}</code></pre>
        </div>
      `;
    }

    // Answers Section HTML
    let answersHtml = '';
    if (q.answers && q.answers.length > 0) {
      answersHtml = `
        <div class="mt-4 pt-3 border-t border-slate-100 space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
              <i class="fa-solid fa-circle-check text-emerald-600"></i> Solution (${q.answers.length})
            </span>
          </div>

          ${q.answers.map((ans, aIdx) => `
            <div class="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 text-slate-800 text-xs sm:text-sm space-y-2.5">
              <div class="flex items-center justify-between text-xs text-slate-500 pb-2 border-b border-emerald-200/60">
                <span class="font-semibold text-emerald-800 flex items-center gap-1.5">
                  <i class="fa-solid fa-user-check text-emerald-600"></i> ${ans.author || 'Solver'}
                </span>
                <div class="flex items-center gap-2">
                  <span>${timeAgo(ans.createdAt)}</span>
                  <button 
                    onclick="copyToClipboard(decodeURIComponent('${encodeURIComponent((ans.content || '') + (ans.code ? '\n\n' + ans.code : ''))}'), this)" 
                    class="px-2.5 py-1 rounded-md bg-white hover:bg-emerald-100 text-emerald-800 text-xs font-semibold border border-emerald-300 flex items-center gap-1 shadow-sm transition"
                  >
                    <i class="fa-solid fa-copy text-emerald-600"></i> Copy Solution
                  </button>
                </div>
              </div>

              ${ans.content ? `<div class="text-xs sm:text-sm leading-relaxed text-slate-800">${renderContent(ans.content)}</div>` : ''}

              ${ans.code ? `
                <div class="relative mt-2">
                  <div class="flex items-center justify-between text-[11px] bg-slate-800 text-slate-300 px-3 py-1.5 rounded-t-lg font-mono">
                    <span>${ans.language || 'Solution Code'}</span>
                    <button onclick="copyToClipboard(decodeURIComponent('${encodeURIComponent(ans.code)}'), this)" class="hover:text-white transition flex items-center gap-1">
                      <i class="fa-solid fa-copy"></i> Copy Code
                    </button>
                  </div>
                  <pre class="rounded-b-lg border-b border-x border-slate-700 !mt-0 !text-xs"><code class="language-${ans.language || 'plaintext'}">${escapeHtml(ans.code)}</code></pre>
                </div>
              ` : ''}

              ${ans.attachments && ans.attachments.length > 0 ? `
                <div class="mt-2 flex flex-wrap gap-2">
                  ${ans.attachments.map(img => `
                    <img src="${img}" class="w-20 h-20 object-cover rounded-lg border border-emerald-200 cursor-pointer hover:border-emerald-500 transition" onclick="openImageModal('${img}')">
                  `).join('')}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      `;
    }

    // Action button to answer
    const answerActionBtn = `
      <button 
        onclick="openAnswerModal('${q.id}')" 
        class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition"
      >
        <i class="fa-solid fa-pen-nib"></i> ${q.answers && q.answers.length > 0 ? 'Add Answer' : 'Answer This'}
      </button>
    `;

    card.innerHTML = `
      <!-- Header -->
      <div class="flex items-start justify-between gap-2">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="text-xs font-mono font-bold text-indigo-600">#${q.questionNumber || '1'}</span>
            <span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-medium">${q.subject || 'General'}</span>
            ${urgencyBadge}
          </div>
          <h3 class="text-sm font-bold text-slate-900 tracking-tight">${escapeHtml(q.title)}</h3>
        </div>
        <div class="flex items-center gap-2">
          ${statusPill}
          <button onclick="deleteQuestion('${q.id}')" class="text-slate-400 hover:text-rose-600 text-xs p-1 transition" title="Delete question">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>

      <!-- Problem statement -->
      ${q.details ? `<div class="mt-2 text-xs sm:text-sm text-slate-700 leading-relaxed">${renderContent(q.details)}</div>` : ''}

      <!-- Attachments & Code -->
      ${attachmentsHtml}
      ${codeHtml}

      <!-- Action Footer -->
      <div class="mt-3 pt-2.5 border-t border-slate-100 text-[11px] text-slate-500 flex items-center justify-between">
        <span>Uploaded ${timeAgo(q.createdAt)}</span>
        <div>
          ${answerActionBtn}
        </div>
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

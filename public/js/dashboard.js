const socket = io({ transports: ['websocket', 'polling'], timeout: 5000, reconnectionAttempts: 5 });
let allQuestions = [];
let activeFilter = 'all';
let searchQuery = '';

socket.on('connect_error', () => {
  // Graceful fallback to REST polling on serverless hosting
});

socket.emit('register_role', 'dashboard');

// Polling interval as a resilient fallback for serverless hosting
setInterval(loadDashboardData, 3000);

// Online stats
socket.on('online_stats', (stats) => {
  const onlineElem = document.getElementById('stat-online');
  if (onlineElem) {
    onlineElem.textContent = stats.totalOnline || '1';
  }
});

// Real-time events
socket.on('new_question', (question) => {
  const exists = allQuestions.find(q => q.id === question.id);
  if (!exists) {
    allQuestions.unshift(question);
    renderDashboard();
    SoundManager.playQuestionAlert();
    showToast(`New question added: #${question.questionNumber || '1'}`, 'question', 'Live Update');
  }
});

socket.on('status_updated', (data) => {
  const q = allQuestions.find(item => item.id === data.questionId);
  if (q) {
    q.status = data.status;
    q.solverName = data.solverName;
    q.updatedAt = data.updatedAt;
    renderDashboard();
  }
});

socket.on('new_answer', (data) => {
  const q = allQuestions.find(item => item.id === data.questionId);
  if (q) {
    if (!q.answers) q.answers = [];
    q.answers.push(data.answer);
    q.status = 'solved';
    renderDashboard();
    SoundManager.playAnswerAlert();
    showToast(`Answer posted for "${q.title}"`, 'answer', 'Live Update');
  }
});

socket.on('question_deleted', (data) => {
  allQuestions = allQuestions.filter(item => item.id !== data.questionId);
  renderDashboard();
});

socket.on('all_cleared', () => {
  allQuestions = [];
  renderDashboard();
  showToast('All items cleared', 'info');
});

// Load Initial & Polling Data
async function loadDashboardData() {
  try {
    const res = await fetch('/api/questions');
    const data = await res.json();
    if (data.success) {
      const hasChanged = JSON.stringify(allQuestions) !== JSON.stringify(data.questions);
      if (hasChanged) {
        allQuestions = data.questions;
        renderDashboard();
      }
    }
  } catch (err) {
    // Silently ignore polling glitches
  }
}

// Search
function handleSearch(e) {
  searchQuery = e.target.value.toLowerCase().trim();
  renderDashboard();
}

// Filter
function setDashFilter(filter) {
  activeFilter = filter;
  document.querySelectorAll('.dash-filter-btn').forEach(btn => {
    if (btn.getAttribute('data-filter') === filter) {
      btn.className = 'dash-filter-btn px-3 py-1 rounded-lg bg-indigo-600 text-white font-semibold';
    } else {
      btn.className = 'dash-filter-btn px-3 py-1 rounded-lg text-slate-400 hover:text-white';
    }
  });
  renderDashboard();
}

// Export as Markdown
function exportDataAsMarkdown() {
  if (allQuestions.length === 0) {
    showToast('No questions to export!', 'warning');
    return;
  }

  let md = `# Exam Solutions & Notes Export\nGenerated: ${new Date().toLocaleString()}\n\n---\n\n`;

  allQuestions.forEach((q, idx) => {
    md += `## Q${idx + 1}: ${q.title}\n`;
    md += `**Subject:** ${q.subject || 'General'} | **Urgency:** ${q.urgency} | **Status:** ${q.status}\n\n`;
    
    if (q.details) {
      md += `### Problem Statement:\n${q.details}\n\n`;
    }
    if (q.code) {
      md += `### Starter Code:\n\`\`\`${q.language || ''}\n${q.code}\n\`\`\`\n\n`;
    }

    if (q.answers && q.answers.length > 0) {
      md += `### Solution(s):\n`;
      q.answers.forEach((ans, aIdx) => {
        md += `#### Solution ${aIdx + 1} (by ${ans.author || 'Solver'} - ${new Date(ans.createdAt).toLocaleTimeString()}):\n`;
        if (ans.content) {
          md += `${ans.content}\n\n`;
        }
        if (ans.code) {
          md += `\`\`\`${ans.language || ''}\n${ans.code}\n\`\`\`\n\n`;
        }
      });
    } else {
      md += `*Status: Unsolved / Pending*\n\n`;
    }

    md += `---\n\n`;
  });

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `exam-solutions-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Markdown export downloaded!', 'success');
}

// Render Dashboard
function renderDashboard() {
  const feed = document.getElementById('dashboard-feed');
  const statTotal = document.getElementById('stat-total');
  const statPending = document.getElementById('stat-pending');
  const statSolved = document.getElementById('stat-solved');

  // Stats calculation
  const total = allQuestions.length;
  const pending = allQuestions.filter(q => q.status === 'pending' || q.status === 'in_progress').length;
  const solved = allQuestions.filter(q => q.status === 'solved').length;

  if (statTotal) statTotal.textContent = total;
  if (statPending) statPending.textContent = pending;
  if (statSolved) statSolved.textContent = solved;

  // Filter
  let filtered = allQuestions;
  if (activeFilter === 'pending') {
    filtered = filtered.filter(q => q.status === 'pending');
  } else if (activeFilter === 'in_progress') {
    filtered = filtered.filter(q => q.status === 'in_progress');
  } else if (activeFilter === 'solved') {
    filtered = filtered.filter(q => q.status === 'solved');
  }

  // Search
  if (searchQuery) {
    filtered = filtered.filter(q => {
      const inTitle = (q.title || '').toLowerCase().includes(searchQuery);
      const inDetails = (q.details || '').toLowerCase().includes(searchQuery);
      const inCode = (q.code || '').toLowerCase().includes(searchQuery);
      const inSubject = (q.subject || '').toLowerCase().includes(searchQuery);
      const inAnswers = (q.answers || []).some(a => 
        (a.content || '').toLowerCase().includes(searchQuery) ||
        (a.code || '').toLowerCase().includes(searchQuery)
      );
      return inTitle || inDetails || inCode || inSubject || inAnswers;
    });
  }

  if (filtered.length === 0) {
    feed.innerHTML = `
      <div class="p-16 text-center rounded-2xl glass-panel border border-slate-800 flex flex-col items-center justify-center gap-3">
        <div class="w-16 h-16 rounded-2xl bg-slate-800/80 flex items-center justify-center text-slate-500 text-2xl">
          <i class="fa-solid fa-table-list"></i>
        </div>
        <div class="text-base font-bold text-white">No Matching Questions</div>
        <p class="text-xs text-slate-400">Try adjusting your search query or filter tags.</p>
      </div>
    `;
    return;
  }

  feed.innerHTML = '';

  filtered.forEach(q => {
    const card = document.createElement('div');
    card.className = 'glass-panel p-6 rounded-2xl border border-slate-800 space-y-4';

    // Status pill
    let statusPill = '';
    if (q.status === 'pending') {
      statusPill = `<span class="px-2.5 py-1 rounded-full bg-amber-950/60 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-1.5"><i class="fa-solid fa-hourglass-start animate-spin"></i> Pending</span>`;
    } else if (q.status === 'in_progress') {
      statusPill = `<span class="px-2.5 py-1 rounded-full bg-indigo-950/80 text-indigo-300 border border-indigo-500/40 text-xs font-semibold flex items-center gap-1.5 animate-pulse"><i class="fa-solid fa-bolt text-indigo-400"></i> In Progress (${q.solverName || 'Solver'})</span>`;
    } else if (q.status === 'solved') {
      statusPill = `<span class="px-2.5 py-1 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 text-xs font-semibold flex items-center gap-1.5"><i class="fa-solid fa-circle-check text-emerald-400"></i> Solved</span>`;
    }

    // Urgency
    const urgencyBadge = {
      urgent: '<span class="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold"><i class="fa-solid fa-fire mr-1"></i>URGENT</span>',
      high: '<span class="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold"><i class="fa-solid fa-bolt mr-1"></i>HIGH</span>',
      normal: '<span class="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 text-[10px] font-medium">Normal</span>'
    }[q.urgency] || '';

    // Attachments
    let attachmentsHtml = '';
    if (q.attachments && q.attachments.length > 0) {
      attachmentsHtml = `
        <div class="flex flex-wrap gap-2 pt-2">
          ${q.attachments.map(url => `
            <img src="${url}" class="w-16 h-16 object-cover rounded-lg border border-slate-700 cursor-pointer hover:border-indigo-500 transition" onclick="openImageModal('${url}')">
          `).join('')}
        </div>
      `;
    }

    // Starter code
    let codeHtml = '';
    if (q.code) {
      codeHtml = `
        <div class="mt-2 relative">
          <div class="flex items-center justify-between text-[11px] bg-slate-900 px-3 py-1 rounded-t-lg border-t border-x border-slate-800 text-slate-400 font-mono">
            <span>Starter Code (${q.language || 'Code'})</span>
            <button onclick="copyToClipboard(decodeURIComponent('${encodeURIComponent(q.code)}'), this)" class="hover:text-white transition flex items-center gap-1">
              <i class="fa-solid fa-copy"></i> Copy
            </button>
          </div>
          <pre class="rounded-b-lg border-b border-x border-slate-800 !mt-0 !text-xs"><code class="language-${q.language || 'plaintext'}">${escapeHtml(q.code)}</code></pre>
        </div>
      `;
    }

    // Answers
    let answersHtml = '';
    if (q.answers && q.answers.length > 0) {
      answersHtml = `
        <div class="mt-4 pt-4 border-t border-slate-800 space-y-3">
          <div class="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
            <i class="fa-solid fa-circle-check"></i> Verified Solution
          </div>

          ${q.answers.map(ans => `
            <div class="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/20 space-y-2">
              <div class="flex items-center justify-between text-xs text-slate-400">
                <span class="font-semibold text-emerald-300">${ans.author || 'Solver'}</span>
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

              ${ans.content ? `<div class="text-xs sm:text-sm text-slate-200">${renderContent(ans.content)}</div>` : ''}

              ${ans.code ? `
                <div class="relative mt-2">
                  <div class="flex items-center justify-between text-[11px] bg-slate-900 px-3 py-1 rounded-t-lg border border-slate-800 text-slate-400 font-mono">
                    <span>${ans.language || 'Code Solution'}</span>
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
                    <img src="${img}" class="w-16 h-16 object-cover rounded-lg border border-slate-700 cursor-pointer hover:border-emerald-400 transition" onclick="openImageModal('${img}')">
                  `).join('')}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      `;
    }

    card.innerHTML = `
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs font-mono font-bold text-violet-400">#${q.questionNumber || '1'}</span>
          <span class="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-medium">${q.subject || 'General'}</span>
          ${urgencyBadge}
          <h3 class="text-sm font-bold text-white ml-1">${escapeHtml(q.title)}</h3>
        </div>
        <div class="flex items-center gap-2 self-start sm:self-auto">
          ${statusPill}
          <span class="text-[11px] text-slate-500">${timeAgo(q.createdAt)}</span>
        </div>
      </div>

      ${q.details ? `<div class="text-xs sm:text-sm text-slate-300">${renderContent(q.details)}</div>` : ''}
      ${attachmentsHtml}
      ${codeHtml}
      ${answersHtml}
    `;

    feed.appendChild(card);
  });

  if (window.Prism) {
    window.Prism.highlightAll();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadDashboardData();
});

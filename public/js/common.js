/**
 * Common Utilities for Lab Exam Live Q&A Portal
 * Handles Web Audio Chimes, Toast Notifications, Markdown/Math Rendering,
 * Image Paste / Zoom, and Socket.IO Helpers.
 */

// Initialize Audio Context lazily on user gesture
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// Sound Management
const SoundManager = {
  isMuted: localStorage.getItem('sound_muted') === 'true',

  toggleMute() {
    this.isMuted = !this.isMuted;
    localStorage.setItem('sound_muted', this.isMuted);
    this.updateMuteIcons();
    showToast(this.isMuted ? 'Sound muted' : 'Sound enabled', 'info', 'Audio', 2000);
    return this.isMuted;
  },

  updateMuteIcons() {
    document.querySelectorAll('.mute-btn-icon').forEach(el => {
      el.className = this.isMuted ? 'fa-solid fa-volume-xmark mute-btn-icon' : 'fa-solid fa-volume-high mute-btn-icon';
    });
  },

  // Synthesized Question chime (Dual tone ring)
  playQuestionAlert() {
    if (this.isMuted) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      
      const now = ctx.currentTime;
      
      // Tone 1
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5
      gain1.gain.setValueAtTime(0.3, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.5);

      // Tone 2 (harmonized)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.15); // A5
      osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.35); // D6
      gain2.gain.setValueAtTime(0.25, now + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.15);
      osc2.stop(now + 0.65);
    } catch (e) {
      console.warn('Audio playback not allowed yet:', e);
    }
  },

  // Synthesized Answer chime (Celebration / Major chord arpeggio)
  playAnswerAlert() {
    if (this.isMuted) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);
        gain.gain.setValueAtTime(0.2, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.4);
      });
    } catch (e) {
      console.warn('Audio playback error:', e);
    }
  },

  // Quick Ping / Test
  playPing() {
    if (this.isMuted) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(987.77, now); // B5
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    } catch (e) {
      console.warn('Audio error:', e);
    }
  }
};

// Toast Notifications
function showToast(message, type = 'info', title = '', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  const typeConfig = {
    success: {
      bg: 'bg-white border-emerald-300 text-emerald-950 shadow-lg',
      icon: 'fa-circle-check text-emerald-600',
      defaultTitle: 'Success'
    },
    error: {
      bg: 'bg-white border-rose-300 text-rose-950 shadow-lg',
      icon: 'fa-circle-exclamation text-rose-600',
      defaultTitle: 'Error'
    },
    warning: {
      bg: 'bg-white border-amber-300 text-amber-950 shadow-lg',
      icon: 'fa-triangle-exclamation text-amber-600',
      defaultTitle: 'Notice'
    },
    question: {
      bg: 'bg-white border-indigo-300 text-indigo-950 shadow-lg',
      icon: 'fa-circle-question text-indigo-600',
      defaultTitle: 'New Question'
    },
    answer: {
      bg: 'bg-emerald-50 border-emerald-400 text-emerald-950 shadow-lg',
      icon: 'fa-circle-check text-emerald-600',
      defaultTitle: 'Answer Ready!'
    },
    info: {
      bg: 'bg-white border-slate-300 text-slate-900 shadow-lg',
      icon: 'fa-circle-info text-indigo-600',
      defaultTitle: 'Update'
    }
  }[type] || {
    bg: 'bg-white border-slate-300 text-slate-900 shadow-lg',
    icon: 'fa-circle-info text-indigo-600',
    defaultTitle: 'Notice'
  };

  toast.className = `toast p-3.5 rounded-xl border flex items-start gap-3 transform transition-all duration-200 animate-slide-down ${typeConfig.bg}`;
  
  toast.innerHTML = `
    <i class="fa-solid ${typeConfig.icon} text-base mt-0.5"></i>
    <div class="flex-1">
      <div class="font-bold text-xs text-slate-900">${title || typeConfig.defaultTitle}</div>
      <div class="text-xs text-slate-600 mt-0.5 leading-relaxed">${escapeHtml(message)}</div>
    </div>
    <button class="text-slate-400 hover:text-slate-700 text-xs p-1" onclick="this.parentElement.remove()">
      <i class="fa-solid fa-xmark"></i>
    </button>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Escape HTML utility
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Relative time formatting
function timeAgo(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Format exact time
function formatExactTime(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Markdown & Math Renderer
function renderContent(rawText) {
  if (!rawText) return '';

  let html = rawText;

  // Render LaTeX blocks $$math$$ and inline $math$ if KaTeX is present
  if (window.katex) {
    // Block math $$...$$
    html = html.replace(/\$\$([\s\S]+?)\$\$/g, (match, formula) => {
      try {
        return `<div class="katex-block my-2 overflow-x-auto text-center">${window.katex.renderToString(formula, { displayMode: true, throwOnError: false })}</div>`;
      } catch (e) {
        return match;
      }
    });

    // Inline math $...$
    html = html.replace(/\$([^\$\n]+?)\$/g, (match, formula) => {
      try {
        return `<span class="katex-inline">${window.katex.renderToString(formula, { displayMode: false, throwOnError: false })}</span>`;
      } catch (e) {
        return match;
      }
    });
  }

  // If marked.js is available, parse markdown
  if (window.marked) {
    try {
      html = window.marked.parse(html);
    } catch (e) {
      console.warn('Marked parse error:', e);
    }
  } else {
    // Fallback simple line breaks
    html = html.replace(/\n/g, '<br>');
  }

  return html;
}

// Copy to clipboard helper
function copyToClipboard(text, btnElement) {
  if (!navigator.clipboard) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      flashCopySuccess(btnElement);
    } catch (err) {
      showToast('Failed to copy', 'error');
    }
    document.body.removeChild(textArea);
    return;
  }

  navigator.clipboard.writeText(text).then(() => {
    flashCopySuccess(btnElement);
  }).catch(() => {
    showToast('Failed to copy to clipboard', 'error');
  });
}

function flashCopySuccess(btnElement) {
  if (!btnElement) {
    showToast('Copied to clipboard!', 'success');
    return;
  }
  const originalHtml = btnElement.innerHTML;
  btnElement.innerHTML = `<i class="fa-solid fa-check text-emerald-400"></i> Copied!`;
  btnElement.classList.add('border-emerald-500', 'text-emerald-400');
  setTimeout(() => {
    btnElement.innerHTML = originalHtml;
    btnElement.classList.remove('border-emerald-500', 'text-emerald-400');
  }, 2000);
}

// Modal Image Viewer
function openImageModal(imgSrc) {
  let modal = document.getElementById('global-image-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'global-image-modal';
    modal.className = 'fixed inset-0 z-[99999] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 transition-all duration-300 hidden';
    modal.innerHTML = `
      <div class="relative max-w-5xl max-h-[90vh] flex flex-col items-center">
        <div class="absolute -top-12 right-0 flex items-center gap-2">
          <a id="modal-download-btn" href="#" download class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs flex items-center gap-1.5 border border-slate-600 transition">
            <i class="fa-solid fa-download"></i> Download
          </a>
          <button id="modal-close-btn" class="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center border border-slate-600 transition">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <img id="modal-image-elem" src="" alt="Full view" class="max-w-full max-h-[85vh] rounded-xl object-contain shadow-2xl border border-slate-700">
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('#modal-close-btn')) {
        modal.classList.add('hidden');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
        modal.classList.add('hidden');
      }
    });
  }

  const imgElem = modal.querySelector('#modal-image-elem');
  const dlBtn = modal.querySelector('#modal-download-btn');
  imgElem.src = imgSrc;
  dlBtn.href = imgSrc;
  modal.classList.remove('hidden');
}

// Setup Clipboard Paste Handler for Image Uploads
function setupImagePasteAndDrop(dropzoneElem, onUploadSuccess) {
  if (!dropzoneElem) return;

  // 1. Paste event (Ctrl+V) anywhere on the target or active document
  window.addEventListener('paste', async (e) => {
    // If active element is an input or textarea that is not our dropzone, check if it's an image
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    let hasImage = false;

    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        hasImage = true;
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = async (event) => {
          const base64Data = event.target.result;
          await uploadBase64Image(base64Data, onUploadSuccess);
        };
        reader.readAsDataURL(blob);
      }
    }
  });

  // 2. Drag and drop events
  dropzoneElem.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzoneElem.classList.add('dragover');
  });

  dropzoneElem.addEventListener('dragleave', () => {
    dropzoneElem.classList.remove('dragover');
  });

  dropzoneElem.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropzoneElem.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          await uploadSingleFile(file, onUploadSuccess);
        }
      }
    }
  });
}

// Helper: Upload file via FormData
async function uploadSingleFile(file, callback) {
  showToast(`Uploading ${file.name}...`, 'info');
  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      showToast('Image uploaded successfully!', 'success');
      if (callback) callback(data.url);
    } else {
      showToast(data.error || 'Upload failed', 'error');
    }
  } catch (err) {
    showToast('Failed to upload image', 'error');
  }
}

// Helper: Upload Base64 Image (from Ctrl+V paste)
async function uploadBase64Image(base64Data, callback) {
  showToast('Processing pasted screenshot...', 'info');
  try {
    const res = await fetch('/api/upload-base64', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Data })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Screenshot attached!', 'success');
      if (callback) callback(data.url);
    } else {
      showToast(data.error || 'Failed to attach pasted image', 'error');
    }
  } catch (err) {
    showToast('Error uploading pasted screenshot', 'error');
  }
}

// Theme management (Dark / Light toggle)
function initTheme() {
  const isLight = localStorage.getItem('theme_light') === 'true';
  if (isLight) {
    document.body.classList.add('light-theme');
  }
}

function toggleTheme() {
  const isLight = document.body.classList.toggle('light-theme');
  localStorage.setItem('theme_light', isLight);
}

// Initialize on DOM loaded
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  SoundManager.updateMuteIcons();

  // Unlock AudioContext on first click anywhere
  document.addEventListener('click', () => {
    getAudioContext();
  }, { once: true });
});

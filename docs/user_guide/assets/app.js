/* ==========================================================================
   Fortnite Replay Suite — User Guide · app.js
   ========================================================================== */

(function () {
  const THEME_KEY = 'fr-guide-theme';
  const MODE_KEY  = 'fr-guide-mode';
  const root = document.documentElement;

  /* ── theme / mode ── */
  function applyTheme(theme, mode) {
    root.setAttribute('data-theme', theme || 'void');
    root.setAttribute('data-mode',  mode  || 'dark');
    document.querySelectorAll('.tw-opt').forEach(el => {
      el.classList.toggle('active', el.dataset.t === (theme || 'void'));
    });
    document.querySelectorAll('.tw-mode-btn').forEach(el => {
      el.classList.toggle('active', el.dataset.m === (mode || 'dark'));
    });
    const modeBtn = document.querySelector('[data-mode-toggle]');
    if (modeBtn) modeBtn.textContent = (mode === 'light') ? '☾ Dark' : '☀ Light';
  }

  function setTheme(t) {
    localStorage.setItem(THEME_KEY, t);
    applyTheme(t, localStorage.getItem(MODE_KEY) || 'dark');
  }
  function setMode(m) {
    localStorage.setItem(MODE_KEY, m);
    applyTheme(localStorage.getItem(THEME_KEY) || 'void', m);
  }
  function toggleMode() {
    const cur = root.getAttribute('data-mode') || 'dark';
    setMode(cur === 'dark' ? 'light' : 'dark');
  }

  // apply ASAP to avoid flash
  applyTheme(localStorage.getItem(THEME_KEY), localStorage.getItem(MODE_KEY));

  /* ── read progress bar ── */
  function initProgress() {
    const bar = document.getElementById('read-progress');
    if (!bar) return;
    function update() {
      const el = document.documentElement;
      const max = el.scrollHeight - el.clientHeight;
      bar.style.width = max > 0 ? (window.scrollY / max * 100) + '%' : '0%';
    }
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  /* ── code copy buttons ── */
  function initCopy() {
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pre = btn.closest('.code-wrap')?.querySelector('pre');
        if (!pre) return;
        navigator.clipboard.writeText(pre.textContent.trim()).then(() => {
          btn.classList.add('copied');
          btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg> copied!';
          setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg> copy';
          }, 2000);
        });
      });
    });
  }

  /* ── tweaks panel ── */
  function initTweaks() {
    window.addEventListener('message', e => {
      if (e.data?.type === '__activate_edit_mode')   document.getElementById('tweaks-panel')?.classList.add('visible');
      if (e.data?.type === '__deactivate_edit_mode') document.getElementById('tweaks-panel')?.classList.remove('visible');
    });
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');

    document.querySelectorAll('.tw-opt').forEach(el => {
      el.addEventListener('click', () => setTheme(el.dataset.t));
    });
    document.querySelectorAll('.tw-mode-btn').forEach(el => {
      el.addEventListener('click', () => setMode(el.dataset.m));
    });
    document.addEventListener('click', e => {
      if (e.target.closest('[data-mode-toggle]')) toggleMode();
    });
  }

  /* ── boot ── */
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(localStorage.getItem(THEME_KEY), localStorage.getItem(MODE_KEY));
    initProgress();
    initCopy();
    initTweaks();
  });

  window.frSetTheme = setTheme;
  window.frSetMode  = setMode;
})();

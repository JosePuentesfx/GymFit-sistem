/* ══════════════════════════════════════════════════════════════════════════
   NovaFit Pro — Access Terminal Logic (Fullscreen)
   ══════════════════════════════════════════════════════════════════════════ */
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let gymData = null;
let resetTimer = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  if (window.accessApi) {
    await loadData();
    window.accessApi.onDbUpdate(loadData);
    // Window controls
    const tbMin = $('#tbMin');
    const tbClose = $('#tbClose');
    const tbFs = $('#tbFs');
    if (tbMin)   tbMin.onclick   = () => window.accessApi.minimize();
    if (tbClose) tbClose.onclick = () => window.accessApi.close();
    if (tbFs)    tbFs.onclick    = () => window.accessApi.toggleFullscreen();
  } else {
    $('#gymName').textContent = 'NOVAFIT';
  }
  startClock();
  setupKeypad();
  setupInput();
  focusPinInput();
}

function focusPinInput() {
  const pinInput = $('#pinInput');
  if (pinInput) pinInput.focus();
}

// ─── Load gym data ────────────────────────────────────────────────────────────
async function loadData() {
  try {
    const pub = await window.accessApi.getPublic();
    gymData = pub;
    const name = pub?.gym?.name || 'NOVAFIT';
    $('#gymName').textContent  = name.toUpperCase();
    $('#gymLogo').textContent  = name.charAt(0).toUpperCase();

    // Apply theme from storage
    const savedTheme = localStorage.getItem('novafit-theme') || 'dark';
    document.documentElement.dataset.theme = savedTheme;
  } catch (e) {
    console.error('Error loading data:', e);
  }
}

// ─── Clock ────────────────────────────────────────────────────────────────────
function startClock() {
  const update = () => {
    const now = new Date();
    $('#terminalTime').textContent = now.toLocaleTimeString('es-MX', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  };
  update();
  setInterval(update, 1000);
}

// ─── Keypad ───────────────────────────────────────────────────────────────────
function setupKeypad() {
  $$('[data-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      const input = $('#pinInput');
      if (key === 'del') {
        input.value = input.value.slice(0, -1);
      } else if (key === 'enter') {
        validate();
      } else {
        if (input.value.length < 12) input.value += key;
      }
      input.classList.toggle('has-value', input.value.length > 0);
      focusPinInput();
    });
  });
}

// ─── Input field ──────────────────────────────────────────────────────────────
function setupInput() {
  const input = $('#pinInput');
  input.addEventListener('input', () => {
    input.classList.toggle('has-value', input.value.length > 0);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') validate();
  });

  // Validate button
  $('#validateBtn').addEventListener('click', validate);

  // Keep input focused when clicking screen
  document.addEventListener('click', e => {
    if (!e.target.closest('.key') && !e.target.closest('.tb-btn') && !e.target.closest('.btn-validate')) {
      focusPinInput();
    }
  });
}

// ─── Validate access ──────────────────────────────────────────────────────────
async function validate() {
  const input = $('#pinInput');
  const value = input.value.trim();
  if (!value) {
    shakeDisplay();
    return;
  }

  const display = $('#statusDisplay');

  // Scanning state
  display.className = 'status-display scanning';
  $('#statusIcon').textContent   = '⌁';
  $('#statusName').textContent   = 'Validando...';
  $('#statusDetail').textContent = 'Comprobando membresía en la base de datos';

  try {
    const result = await window.accessApi.verifyAccess(value);

    if (result.allowed) {
      display.className = 'status-display granted';
      $('#statusIcon').textContent   = '✓';
      $('#statusName').textContent   = '¡ACCESO AUTORIZADO!';
      $('#statusDetail').textContent = `${result.member?.name || ''} — Membresía vigente`;
    } else {
      display.className = 'status-display denied';
      $('#statusIcon').textContent   = '✕';
      $('#statusName').textContent   = 'ACCESO DENEGADO';
      $('#statusDetail').textContent = result.reason || 'No autorizado';
    }

    input.value = '';
    input.classList.remove('has-value');

    // Reset display after 4 seconds
    clearTimeout(resetTimer);
    resetTimer = setTimeout(resetDisplay, 4500);

  } catch (err) {
    display.className = 'status-display denied';
    $('#statusIcon').textContent   = '!';
    $('#statusName').textContent   = 'Error de sistema';
    $('#statusDetail').textContent = err.message;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(resetDisplay, 3000);
  }
}

function resetDisplay() {
  const display = $('#statusDisplay');
  display.className = 'status-display idle';
  $('#statusIcon').textContent   = '⌁';
  $('#statusName').textContent   = 'Bienvenido';
  $('#statusDetail').textContent = 'Ingresa tu clave de 4 dígitos o pasa tu huella';
  focusPinInput();
}

function shakeDisplay() {
  const display = $('#statusDisplay');
  display.style.animation = 'none';
  void display.offsetWidth;
  display.style.animation = 'denyShake .3s ease';
  setTimeout(() => display.style.animation = '', 350);
}

// ─── Listen for theme changes from main window ────────────────────────────────
window.addEventListener('storage', e => {
  if (e.key === 'novafit-theme') {
    document.documentElement.dataset.theme = e.newValue || 'dark';
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

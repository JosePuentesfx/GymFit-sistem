/* ══════════════════════════════════════════════════════════════════════════
   NovaFit Pro v2.0 — Renderer / App logic
   ══════════════════════════════════════════════════════════════════════════ */
'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let db            = null;
let currentUser   = null;
let currentView   = 'overview';
let confirmCb     = null;
let editingMemberId = null;
let currency      = 'MXN';

// ─── Utils ────────────────────────────────────────────────────────────────────
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function money(n) {
  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency', currency: currency || 'MXN', maximumFractionDigits: 2
    }).format(Number(n) || 0);
  } catch {
    return `$${Number(n || 0).toFixed(2)}`;
  }
}

function initials(name) {
  return (name || '?').split(' ').slice(0, 2).map(x => x[0] || '').join('').toUpperCase() || '?';
}

function avatarColor(name) {
  const colors = [
    'linear-gradient(135deg,#4f8ef7,#6366f1)',
    'linear-gradient(135deg,#22c55e,#16a34a)',
    'linear-gradient(135deg,#f59e0b,#d97706)',
    'linear-gradient(135deg,#ef4444,#dc2626)',
    'linear-gradient(135deg,#a855f7,#7c3aed)',
    'linear-gradient(135deg,#06b6d4,#0891b2)',
    'linear-gradient(135deg,#f97316,#ea580c)',
  ];
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + (name.charCodeAt(i) || 0)) & 0xffff;
  return colors[h % colors.length];
}

function today() { return new Date().toISOString().slice(0, 10); }

function paymentStatus(dueDate) {
  if (!dueDate) return 'vencido';
  const diff = Math.ceil((new Date(dueDate + 'T12:00:00') - new Date(today() + 'T12:00:00')) / 86400000);
  if (diff < 0)  return 'vencido';
  if (diff <= 7) return 'por-vencer';
  return 'vigente';
}

function statusBadge(s) {
  const map = {
    'vigente':    ['badge-green',  'Vigente'],
    'por-vencer': ['badge-amber',  'Por vencer'],
    'vencido':    ['badge-red',    'Vencido'],
  };
  const [cls, label] = map[s] || ['badge-blue', s];
  return `<span class="badge ${cls}">${label}</span>`;
}

function memberLatestPayment(memberId) {
  if (!db || !db.payments) return null;
  return db.payments
    .filter(p => p.memberId === memberId)
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0] || null;
}

function memberStatus(memberId) {
  const p = memberLatestPayment(memberId);
  return p ? paymentStatus(p.dueDate) : 'vencido';
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-MX', {
      day: 'numeric', month: 'short', year: 'numeric'
    });
  } catch { return iso.slice(0, 10); }
}

function daysLeft(dueDate) {
  if (!dueDate) return -999;
  return Math.ceil((new Date(dueDate + 'T12:00:00') - new Date(today() + 'T12:00:00')) / 86400000);
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(message, type = 'success') {
  const el = $('#toast');
  if (!el) return;
  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  el.innerHTML = `<span class="toast-icon">${icons[type] || '✓'}</span><span>${esc(message)}</span>`;
  el.className = `toast toast-${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

// ─── Modal helpers ────────────────────────────────────────────────────────────
function openModal(id) {
  const el = $(`#${id}`);
  if (el) el.classList.add('open');
}
function closeModal(id) {
  const el = $(`#${id}`);
  if (el) el.classList.remove('open');
}
function closeAllModals() {
  $$('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
}

// Close on backdrop click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-backdrop')) {
    e.target.classList.remove('open');
  }
});
// Close button
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-close')) {
    e.target.closest('.modal-backdrop')?.classList.remove('open');
  }
  if (e.target.classList.contains('modal-close-btn')) {
    e.target.closest('.modal-backdrop')?.classList.remove('open');
  }
});
// data-modal triggers (simple ones like staffModal, receiptModal, confirmModal)
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-modal]');
  if (btn) openModal(btn.dataset.modal);
});
// Special action triggers
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action="open-member-new"]');
  if (btn) { openMemberModal(null); return; }
  const btn2 = e.target.closest('[data-action="open-payment-new"]');
  if (btn2 && db) { openPaymentModal(); return; }
});

// Keyboard ESC
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeAllModals();
});

// ─── Confirm dialog ───────────────────────────────────────────────────────────
function showConfirm(title, message, onOk) {
  const titleEl = $('#confirmTitle');
  const msgEl   = $('#confirmMessage');
  if (titleEl) titleEl.textContent = title;
  if (msgEl)   msgEl.textContent   = message;
  confirmCb = onOk;
  openModal('confirmModal');
}

document.addEventListener('click', async e => {
  if (e.target.id === 'confirmOk') {
    if (confirmCb) {
      try { await confirmCb(); } catch (err) { toast(err.message, 'error'); }
    }
    closeModal('confirmModal');
    confirmCb = null;
  }
  if (e.target.id === 'confirmCancel') {
    closeModal('confirmModal');
    confirmCb = null;
  }
});

// ─── Window controls (Electron title bar) ────────────────────────────────────
if (window.gymApi) {
  const tcMin   = $('#tcMin');
  const tcMax   = $('#tcMax');
  const tcClose = $('#tcClose');
  if (tcMin)   tcMin.onclick   = () => window.gymApi.minimize();
  if (tcMax)   tcMax.onclick   = () => window.gymApi.maximize();
  if (tcClose) tcClose.onclick = () => window.gymApi.close();
} else {
  // Not running in Electron — hide titlebar
  const tb = $('.titlebar');
  if (tb) tb.style.display = 'none';
}

// ─── Theme & Font Size ────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('novafit-theme', theme);
  const btn = $('#themeToggleBtn');
  if (btn) btn.textContent = theme === 'light' ? '☀️ Modo Claro' : '🌙 Modo Oscuro';
  const sel = $('#themeSelect');
  if (sel) sel.value = theme;
}

function applyFontSize(size) {
  document.documentElement.style.fontSize = size;
  localStorage.setItem('novafit-fontsize', size);
  const sel = $('#fontSizeSelect');
  if (sel) sel.value = size;
}

// Initial theme & font size setup
const savedTheme = localStorage.getItem('novafit-theme') || 'dark';
applyTheme(savedTheme);

const savedFontSize = localStorage.getItem('novafit-fontsize') || '14px';
applyFontSize(savedFontSize);

// Theme toggle button
document.addEventListener('click', e => {
  if (e.target.closest('#themeToggleBtn')) {
    const current = document.documentElement.dataset.theme || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }
  if (e.target.closest('#terminalToggleBtn')) {
    if (window.gymApi) window.gymApi.toggleTerminal();
  }
});

// Theme & Font selectors in Settings
document.addEventListener('change', e => {
  if (e.target.id === 'themeSelect') applyTheme(e.target.value);
  if (e.target.id === 'fontSizeSelect') applyFontSize(e.target.value);
});

// ─── Biometric Scanner & PIN Generation ──────────────────────────────────────
document.addEventListener('focusin', e => {
  if (e.target.id === 'memberFormBio') {
    const bioStatus = $('#bioScannerStatus');
    if (bioStatus) {
      bioStatus.className = 'bio-scanner-status active';
      bioStatus.querySelector('.scanner-text').textContent = '🔴 DETECTOR ACTIVADO — Coloque el dedo en el lector de huella';
    }
  }
});

document.addEventListener('focusout', e => {
  if (e.target.id === 'memberFormBio') {
    const bioStatus = $('#bioScannerStatus');
    if (bioStatus && !e.target.value.trim()) {
      bioStatus.className = 'bio-scanner-status idle';
      bioStatus.querySelector('.scanner-text').textContent = 'Haz clic en la casilla para activar lectura biométrica';
    }
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'memberFormBio') {
    const bioStatus = $('#bioScannerStatus');
    if (bioStatus && e.target.value.trim()) {
      bioStatus.className = 'bio-scanner-status active';
      bioStatus.querySelector('.scanner-text').textContent = `✓ Valor ingresado: ${e.target.value.trim()}`;
    }
  }
});

document.addEventListener('click', e => {
  if (e.target.closest('#genPinBtn')) {
    const bioInput = $('#memberFormBio');
    const bioStatus = $('#bioScannerStatus');
    if (bioInput) {
      const pin = Math.floor(1000 + Math.random() * 9000).toString();
      bioInput.value = pin;
      if (bioStatus) {
        bioStatus.className = 'bio-scanner-status pin-generated';
        bioStatus.querySelector('.scanner-text').textContent = `🎲 Clave PIN asignada: ${pin} (Sin necesidad de lector)`;
      }
      toast(`Clave PIN asignada: ${pin}`, 'info');
    }
  }
});

// ─── Password toggle ──────────────────────────────────────────────────────────
const passToggle = $('#passToggle');
if (passToggle) {
  passToggle.onclick = () => {
    const inp = $('#loginPass');
    if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    passToggle.textContent = passToggle.textContent === '👁' ? '🙈' : '👁';
  };
}

// ─── Login ────────────────────────────────────────────────────────────────────
const loginForm = $('#loginForm');
if (loginForm) {
  loginForm.onsubmit = async e => {
    e.preventDefault();
    if (!window.gymApi) {
      $('#loginError').textContent = 'Abre la aplicación con "INICIAR NOVAFIT.bat", no directamente con index.html.';
      return;
    }
    const btn = $('#loginBtn');
    btn.innerHTML = '<span class="loading-spinner"></span>';
    btn.disabled = true;
    $('#loginError').textContent = '';
    try {
      const data = Object.fromEntries(new FormData(e.target));
      const user = await window.gymApi.login(data);
      if (!user) {
        $('#loginError').textContent = 'Usuario o contraseña incorrectos.';
        btn.innerHTML = '<span>Iniciar sesión</span><span class="btn-arrow">→</span>';
        btn.disabled = false;
        return;
      }
      await bootApp(user);
    } catch (err) {
      $('#loginError').textContent = `Error al iniciar: ${err.message}`;
      btn.innerHTML = '<span>Iniciar sesión</span><span class="btn-arrow">→</span>';
      btn.disabled = false;
    }
  };
}

async function bootApp(user) {
  currentUser = user;

  // Load DB first
  db = await window.gymApi.getData();
  currency = db?.gym?.currency || 'MXN';

  // Show app shell
  $('#loginView').hidden = true;
  $('#appView').hidden   = false;

  // Fill user chip
  const avatar = $('#userAvatar');
  if (avatar) {
    avatar.textContent    = initials(user.name);
    avatar.style.background = avatarColor(user.name);
  }
  const nameEl = $('#userName');
  const roleEl = $('#userRole');
  if (nameEl) nameEl.textContent = user.name;
  if (roleEl) roleEl.textContent = user.role === 'owner' ? 'Dueño' : 'Recepcionista';

  // Date header
  const todayEl = $('#today');
  if (todayEl) {
    todayEl.textContent = new Date().toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).toUpperCase();
  }

  // Owner-only items
  $$('.owner-only').forEach(el => el.hidden = user.role !== 'owner');

  // Gym name
  updateGymLabel();

  // Render & navigate
  render();
  show('overview');
}

function updateGymLabel() {
  const gymName = db?.gym?.name || 'NOVAFIT';
  const gymNameLabel = $('#gymNameLabel');
  const gymBadgeLabel = $('#gymBadgeLabel');
  if (gymNameLabel) gymNameLabel.textContent = gymName.toUpperCase();
  if (gymBadgeLabel) gymBadgeLabel.textContent = gymName.toUpperCase();
}

// ─── Navigation ───────────────────────────────────────────────────────────────
const VIEW_CONFIG = {
  overview: { title: 'Dashboard',           action: '＋ Registrar pago',       modal: 'paymentModal' },
  members:  { title: 'Socios',              action: '＋ Nuevo socio',           modal: 'memberModal'  },
  payments: { title: 'Pagos y membresías',  action: '＋ Registrar pago',       modal: 'paymentModal' },
  access:   { title: 'Control de acceso',   action: '',                         modal: ''             },
  staff:    { title: 'Equipo',              action: '＋ Agregar recepcionista', modal: 'staffModal'   },
  settings: { title: 'Configuración',       action: '',                         modal: ''             },
};

function show(view) {
  if (!VIEW_CONFIG[view]) return;
  currentView = view;
  $$('.view').forEach(s => s.hidden = s.id !== view);
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));

  const cfg = VIEW_CONFIG[view];
  const titleEl = $('#pageTitle');
  const actionBtn = $('#mainAction');
  if (titleEl) titleEl.textContent = cfg.title;
  if (actionBtn) {
    actionBtn.textContent = cfg.action;
    actionBtn.hidden = !cfg.action;
  }
}

// Nav click delegation
document.addEventListener('click', e => {
  const btn = e.target.closest('.nav-item[data-view]');
  if (btn && !btn.hidden) show(btn.dataset.view);
});

// Main action button
const mainActionBtn = $('#mainAction');
if (mainActionBtn) {
  mainActionBtn.addEventListener('click', () => {
    if (currentView === 'members') {
      openMemberModal(null);
    } else if (currentView === 'staff') {
      openModal('staffModal');
    } else {
      // payments / overview
      openPaymentModal();
    }
  });
}

// "Ver todos" on overview
const goPayments = $('#goPayments');
if (goPayments) goPayments.onclick = () => show('payments');

// Logout
const logoutBtn = $('#logout');
if (logoutBtn) logoutBtn.onclick = () => location.reload();

// ─── Refresh ──────────────────────────────────────────────────────────────────
async function refresh() {
  if (!window.gymApi) return;
  db = await window.gymApi.getData();
  currency = db?.gym?.currency || 'MXN';
  updateGymLabel();
  render();
}

// ─── Render all views ─────────────────────────────────────────────────────────
function render() {
  if (!db) return;
  renderOverview();
  renderMembers();
  renderPayments();
  renderAccess();
  renderStaff();
  renderSettings();
}

// ─── OVERVIEW ─────────────────────────────────────────────────────────────────
function renderOverview() {
  const now = today();
  const thisMonth = now.slice(0, 7);

  const monthPayments = (db.payments || []).filter(p => p.paymentDate && p.paymentDate.startsWith(thisMonth));
  const income = monthPayments.reduce((a, p) => a + Number(p.amount || 0), 0);

  const activeMembers = (db.members || []).filter(m => m.active && memberStatus(m.id) === 'vigente');
  const dueMembers    = (db.members || []).filter(m => m.active && memberStatus(m.id) === 'por-vencer');
  const accessesToday = (db.accessLog || []).filter(a => a.timestamp && a.timestamp.slice(0, 10) === now).length;

  // Animate KPIs
  setKpi('#kpiIncome',  money(income));
  setKpi('#kpiActive',  activeMembers.length);
  setKpi('#kpiDue',     dueMembers.length);
  setKpi('#kpiAccess',  accessesToday);

  const kpiIncomeCount = $('#kpiIncomeCount');
  if (kpiIncomeCount) kpiIncomeCount.textContent = `${monthPayments.length} pago${monthPayments.length !== 1 ? 's' : ''} registrado${monthPayments.length !== 1 ? 's' : ''}`;

  // Nav badge
  const dueBadge = $('#membersBadge');
  if (dueBadge) {
    if (dueMembers.length > 0) { dueBadge.textContent = dueMembers.length; dueBadge.hidden = false; }
    else dueBadge.hidden = true;
  }

  // Due-soon list
  const dueEl = $('#dueSoonList');
  if (dueEl) {
    if (dueMembers.length === 0) {
      dueEl.innerHTML = '<p class="due-empty">✅ Ningún socio por vencer pronto</p>';
    } else {
      dueEl.innerHTML = dueMembers.slice(0, 7).map(m => {
        const p = memberLatestPayment(m.id);
        const d = daysLeft(p?.dueDate);
        const text = d === 0 ? 'Vence hoy' : d < 0 ? `Venció hace ${Math.abs(d)} día${Math.abs(d)!==1?'s':''}` : `${d} día${d!==1?'s':''} restante${d!==1?'s':''}`;
        return `<div class="due-item">
          <div class="due-avatar">${initials(m.name)}</div>
          <div>
            <span class="due-name">${esc(m.name)}</span>
            <span class="due-days">${text}</span>
          </div>
        </div>`;
      }).join('');
    }
  }

  // Chart
  renderIncomeChart();

  // Recent payments table
  const recent = [...(db.payments || [])]
    .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate))
    .slice(0, 8);

  const recentEl = $('#recentPaymentsTable');
  if (recentEl) {
    if (recent.length === 0) {
      recentEl.innerHTML = '<p class="table-empty">Sin pagos registrados aún.</p>';
    } else {
      recentEl.innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>SOCIO</th><th>PLAN</th><th>MONTO</th><th>FECHA PAGO</th><th>VENCE</th><th>ESTADO</th></tr></thead>
        <tbody>${recent.map(p => paymentTableRow(p, false)).join('')}</tbody>
      </table></div>`;
    }
  }
}

function setKpi(sel, val) {
  const el = $(sel);
  if (!el) return;
  el.textContent = val;
  el.classList.remove('number-animate');
  void el.offsetWidth;
  el.classList.add('number-animate');
}

// ─── Income chart ─────────────────────────────────────────────────────────────
let chartAnimFrame;
function renderIncomeChart() {
  const canvas = $('#incomeChart');
  if (!canvas) return;

  // Build 6-month data
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.toISOString().slice(0, 7);
    const label = d.toLocaleDateString('es-MX', { month: 'short' });
    const inc = (db.payments || []).filter(p => p.paymentDate && p.paymentDate.startsWith(key)).reduce((a, p) => a + Number(p.amount || 0), 0);
    months.push({ label, inc });
  }

  cancelAnimationFrame(chartAnimFrame);
  drawChart(canvas, months);
}

function drawChart(canvas, months) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.parentElement.clientWidth || 560;
  const H   = 200;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const maxVal = Math.max(...months.map(m => m.inc), 100);
  const pad = { t: 24, r: 16, b: 38, l: 56 };
  const cW = W - pad.l - pad.r;
  const cH = H - pad.t - pad.b;
  const n  = months.length;
  const gap = cW / n;
  const barW = gap * 0.52;

  // Background grid
  ctx.strokeStyle = 'rgba(255,255,255,.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + cH * (1 - i / 4);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.font = `${9 * (window.devicePixelRatio < 2 ? 1 : 1)}px Inter,sans-serif`;
    ctx.textAlign = 'right';
    const label = new Intl.NumberFormat('es-MX', { notation: 'compact', currency, style:'currency', maximumFractionDigits: 0 }).format(maxVal * i / 4);
    ctx.fillText(label, pad.l - 6, y + 3.5);
  }

  // Bars
  months.forEach((m, i) => {
    const x    = pad.l + i * gap + (gap - barW) / 2;
    const barH = m.inc === 0 ? 2 : Math.max(2, (m.inc / maxVal) * cH);
    const y    = pad.t + cH - barH;
    const isCurrentMonth = (i === months.length - 1);

    const grad = ctx.createLinearGradient(0, y, 0, pad.t + cH);
    if (isCurrentMonth) {
      grad.addColorStop(0, '#4f8ef7');
      grad.addColorStop(1, 'rgba(79,142,247,.35)');
    } else {
      grad.addColorStop(0, 'rgba(79,142,247,.6)');
      grad.addColorStop(1, 'rgba(79,142,247,.1)');
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
    } else {
      ctx.rect(x, y, barW, barH);
    }
    ctx.fill();

    // Value above bar
    if (m.inc > 0) {
      ctx.fillStyle = isCurrentMonth ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.55)';
      ctx.font = `bold 9px Inter,sans-serif`;
      ctx.textAlign = 'center';
      const lbl = new Intl.NumberFormat('es-MX', { notation: 'compact', maximumFractionDigits: 1 }).format(m.inc);
      ctx.fillText(lbl, x + barW / 2, y - 5);
    }

    // Month label
    ctx.fillStyle = isCurrentMonth ? 'rgba(79,142,247,.9)' : 'rgba(255,255,255,.38)';
    ctx.font = `${isCurrentMonth ? 'bold ' : ''}10px Inter,sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(m.label.toUpperCase(), x + barW / 2, H - 10);
  });
}

// ─── MEMBERS ──────────────────────────────────────────────────────────────────
function renderMembers() {
  const q      = ($('#memberSearch')?.value || '').toLowerCase().trim();
  const filter = $('#memberFilter')?.value || 'all';

  let members = (db.members || []).filter(m => m.active);

  if (q) {
    members = members.filter(m =>
      (m.name || '').toLowerCase().includes(q)      ||
      (m.phone || '').toLowerCase().includes(q)     ||
      (m.email || '').toLowerCase().includes(q)     ||
      (m.biometricId || '').toLowerCase().includes(q)
    );
  }

  if (filter !== 'all') {
    members = members.filter(m => memberStatus(m.id) === filter);
  }

  members.sort((a, b) => a.name.localeCompare(b.name));

  const countEl = $('#memberCount');
  if (countEl) countEl.textContent = `${members.length} socio${members.length !== 1 ? 's' : ''}`;

  const tbody = $('#membersTable');
  if (!tbody) return;

  if (members.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6"><span class="empty-icon">♙</span>Sin socios que coincidan con el filtro.</td></tr>`;
    return;
  }

  tbody.innerHTML = members.map(m => {
    const status = memberStatus(m.id);
    const lp     = memberLatestPayment(m.id);
    const dl     = lp ? daysLeft(lp.dueDate) : -999;
    const bg     = avatarColor(m.name);
    return `<tr>
      <td>
        <div class="member-cell">
          <div class="user-avatar" style="background:${bg};width:34px;height:34px;font-size:.72rem;flex-shrink:0">${initials(m.name)}</div>
          <div>
            <strong style="color:var(--text);font-size:.85rem">${esc(m.name)}</strong>
            <small>${esc(m.email || m.phone || '—')}</small>
          </div>
        </div>
      </td>
      <td>
        <div style="font-size:.82rem">${esc(m.phone)}</div>
        <small>${esc(m.email || '—')}</small>
      </td>
      <td><code>${esc(m.biometricId || 'Sin registrar')}</code></td>
      <td>
        ${lp
          ? `<div style="font-size:.82rem">${fmtDate(lp.paymentDate)}</div><small>${esc(lp.plan)}</small>`
          : `<small style="color:var(--text3)">Sin pagos</small>`
        }
      </td>
      <td>
        ${statusBadge(status)}
        ${dl >= 0 && dl <= 7 ? `<small style="display:block;color:var(--amber);margin-top:3px">⏳ ${dl}d</small>` : ''}
      </td>
      <td>
        <div class="row-actions">
          <button class="row-btn" data-action="member-detail" data-id="${m.id}" title="Ver perfil">Ver</button>
          <button class="row-btn" data-action="member-edit"   data-id="${m.id}" title="Editar">Editar</button>
          <button class="row-btn" data-action="member-pay"    data-id="${m.id}" title="Registrar pago">Pago</button>
          <button class="row-btn danger" data-action="member-delete" data-id="${m.id}" data-name="${esc(m.name)}" title="Dar de baja">Baja</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// Search & filter event delegation
$('#memberSearch')?.addEventListener('input', renderMembers);
$('#memberFilter')?.addEventListener('change', renderMembers);

// Member modal — new or edit
function openMemberModal(memberId = null) {
  editingMemberId = memberId;
  const isEdit = !!memberId;
  const m = isEdit ? (db.members || []).find(x => x.id === memberId) : null;

  const tagEl   = $('#memberModalTag');
  const titleEl = $('#memberModalTitle');
  const submitBtn = $('#memberFormSubmit');
  if (tagEl)    tagEl.textContent   = isEdit ? 'EDITAR SOCIO' : 'NUEVO SOCIO';
  if (titleEl)  titleEl.textContent = isEdit ? 'Editar socio' : 'Registrar nuevo socio';
  if (submitBtn) submitBtn.textContent = isEdit ? 'Guardar cambios →' : 'Guardar socio →';

  const form = $('#memberForm');
  if (!form) return;
  form.reset();

  if (isEdit && m) {
    const set = (id, val) => { const el = $(id); if (el) el.value = val || ''; };
    set('#memberFormId', m.id);
    set('#memberFormName', m.name);
    set('#memberFormPhone', m.phone);
    set('#memberFormEmail', m.email);
    set('#memberFormBirthdate', m.birthdate);
    set('#memberFormBio', m.biometricId);
    set('#memberFormEmergency', m.emergencyContact);
    set('#memberFormNotes', m.notes);
  } else {
    const idEl = $('#memberFormId');
    if (idEl) idEl.value = '';
  }

  openModal('memberModal');
}

const memberForm = $('#memberForm');
if (memberForm) {
  memberForm.onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const submitBtn = $('#memberFormSubmit');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Guardando...'; }
    try {
      if (editingMemberId) {
        await window.gymApi.updateMember({ id: editingMemberId, ...data });
        toast('Socio actualizado correctamente');
      } else {
        await window.gymApi.addMember(data);
        toast('Socio registrado correctamente');
      }
      closeModal('memberModal');
      await refresh();
      show('members');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = editingMemberId ? 'Guardar cambios →' : 'Guardar socio →'; }
    }
  };
}

// Member row action delegation
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id     = btn.dataset.id;
  if (action === 'member-detail') { openMemberDetail(id); return; }
  if (action === 'member-edit')   { openMemberModal(id);  return; }
  if (action === 'member-pay')    { openPaymentModal(id); return; }
  if (action === 'member-delete') {
    const name = btn.dataset.name;
    showConfirm('Dar de baja al socio', `¿Deseas dar de baja a ${name}? Se conserva el historial de pagos.`, async () => {
      await window.gymApi.deleteMember(id);
      await refresh();
      toast(`${name} dado de baja`);
    });
  }
  // Staff actions
  if (action === 'staff-toggle') {
    const active = btn.dataset.active === 'true';
    const name   = btn.dataset.name;
    const verb   = active ? 'desactivar' : 'activar';
    showConfirm(`${active ? 'Desactivar' : 'Activar'} usuario`, `¿Deseas ${verb} a ${name}?`, async () => {
      await window.gymApi.toggleUser(id);
      await refresh();
      toast(`${name} ${active ? 'desactivado' : 'activado'}`);
    });
  }
  if (action === 'staff-reset-pass') {
    const resetId = $('#resetUserId');
    if (resetId) resetId.value = id;
    openModal('resetPasswordModal');
  }
  // Payment actions
  if (action === 'payment-receipt') { showReceipt(id); return; }
  if (action === 'payment-delete') {
    const memberName = btn.dataset.member;
    showConfirm('Eliminar pago', `¿Eliminar el pago de ${memberName}? Esta acción es permanente.`, async () => {
      await window.gymApi.deletePayment(id);
      await refresh();
      toast('Pago eliminado');
    });
  }
});

// Member detail modal
function openMemberDetail(memberId) {
  const m = (db.members || []).find(x => x.id === memberId);
  if (!m) return;
  const payments = (db.payments || []).filter(p => p.memberId === memberId).sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));
  const status = memberStatus(m.id);
  const lp = memberLatestPayment(m.id);
  const totalPaid = payments.reduce((a, p) => a + Number(p.amount || 0), 0);

  $('#memberDetailContent').innerHTML = `
    <div class="member-detail-header">
      <div class="member-detail-avatar" style="background:${avatarColor(m.name)}">${initials(m.name)}</div>
      <div class="member-detail-meta">
        <strong>${esc(m.name)}</strong>
        <small>Socio desde ${fmtDate(m.createdAt)}</small>
        <div style="margin-top:8px;display:flex;gap:8px;align-items:center">${statusBadge(status)}</div>
      </div>
      <div style="margin-left:auto;text-align:right">
        <div style="font-size:.7rem;color:var(--text3);margin-bottom:3px">TOTAL PAGADO</div>
        <strong style="font-size:1.3rem;color:var(--green)">${money(totalPaid)}</strong>
        <small style="display:block;color:var(--text3)">${payments.length} pago${payments.length!==1?'s':''}</small>
      </div>
    </div>
    <div class="detail-grid">
      <div class="detail-field"><label>Teléfono</label><span>${esc(m.phone || '—')}</span></div>
      <div class="detail-field"><label>Correo</label><span>${esc(m.email || '—')}</span></div>
      <div class="detail-field"><label>Fecha de nacimiento</label><span>${m.birthdate ? fmtDate(m.birthdate) : '—'}</span></div>
      <div class="detail-field"><label>ID biométrico</label><span><code>${esc(m.biometricId || 'Sin registrar')}</code></span></div>
      <div class="detail-field"><label>Contacto de emergencia</label><span>${esc(m.emergencyContact || '—')}</span></div>
      <div class="detail-field"><label>Membresía vence</label><span style="font-weight:600;color:${lp && paymentStatus(lp.dueDate)==='vigente'?'var(--green)':'var(--red)'}">${lp ? fmtDate(lp.dueDate) : '—'}</span></div>
      ${m.notes ? `<div class="detail-field" style="grid-column:span 2"><label>Notas internas</label><span>${esc(m.notes)}</span></div>` : ''}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h3>Historial de pagos</h3>
      <button class="btn-ghost" style="font-size:.75rem" data-action="member-pay" data-id="${m.id}">＋ Nuevo pago</button>
    </div>
    ${payments.length === 0
      ? '<p style="color:var(--text3);font-size:.82rem;text-align:center;padding:16px">Sin pagos registrados.</p>'
      : payments.map(p => `
        <div class="payment-history-item">
          <div>
            <strong style="font-size:.85rem;color:var(--text)">${esc(p.plan)}</strong>
            <small style="display:block;color:var(--text3)">${fmtDate(p.paymentDate)} · ${esc(p.method || 'Efectivo')}</small>
          </div>
          <div style="text-align:right">
            <strong style="color:var(--green)">${money(p.amount)}</strong>
            <small style="display:block;color:var(--text3)">Vence ${fmtDate(p.dueDate)}</small>
          </div>
          ${statusBadge(paymentStatus(p.dueDate))}
        </div>`).join('')
    }`;
  openModal('memberDetailModal');
}

// ─── PAYMENTS ─────────────────────────────────────────────────────────────────
function populateMonthFilter() {
  const sel = $('#paymentMonthFilter');
  if (!sel) return;
  const months = new Set((db.payments || []).map(p => p.paymentDate?.slice(0, 7)).filter(Boolean));
  const sorted = [...months].sort().reverse();
  const current = sel.value;
  sel.innerHTML = '<option value="">Todos los meses</option>' + sorted.map(m => {
    const [y, mo] = m.split('-');
    const label = new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    return `<option value="${m}">${label.charAt(0).toUpperCase() + label.slice(1)}</option>`;
  }).join('');
  if (current && [...months].includes(current)) sel.value = current;
}

function renderPayments() {
  populateMonthFilter();
  populatePaymentMemberSelect();

  const q       = ($('#paymentSearch')?.value || '').toLowerCase().trim();
  const mFilter = $('#paymentMonthFilter')?.value || '';

  let payments = [...(db.payments || [])].sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));

  if (q) {
    payments = payments.filter(p => {
      const m = (db.members || []).find(x => x.id === p.memberId);
      return (m?.name || '').toLowerCase().includes(q) || (p.plan || '').toLowerCase().includes(q) || (p.method || '').toLowerCase().includes(q);
    });
  }
  if (mFilter) payments = payments.filter(p => p.paymentDate?.startsWith(mFilter));

  const total = payments.reduce((a, p) => a + Number(p.amount || 0), 0);
  const countEl = $('#paymentsCount');
  const totalEl = $('#paymentsTotal');
  if (countEl) countEl.textContent = `${payments.length} pago${payments.length !== 1 ? 's' : ''}`;
  if (totalEl) totalEl.textContent = payments.length ? money(total) : '';

  const tbody = $('#paymentsTable');
  if (!tbody) return;
  if (payments.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8"><span class="empty-icon">◈</span>Sin pagos en este período.</td></tr>`;
    return;
  }
  tbody.innerHTML = payments.map(p => paymentTableRow(p, true)).join('');
}

function paymentTableRow(p, showActions) {
  const m = (db.members || []).find(x => x.id === p.memberId) || { name: 'Socio eliminado' };
  const status = paymentStatus(p.dueDate);
  return `<tr>
    <td>
      <div class="member-cell">
        <div class="user-avatar" style="background:${avatarColor(m.name)};width:28px;height:28px;font-size:.62rem;flex-shrink:0">${initials(m.name)}</div>
        <strong style="color:var(--text);font-size:.82rem">${esc(m.name)}</strong>
      </div>
    </td>
    <td><span class="badge badge-blue">${esc(p.plan)}</span></td>
    <td><small>${esc(p.method || 'Efectivo')}</small></td>
    <td><strong style="color:var(--green)">${money(p.amount)}</strong></td>
    <td style="font-size:.82rem">${fmtDate(p.paymentDate)}</td>
    <td style="font-size:.82rem">${fmtDate(p.dueDate)}</td>
    <td>${statusBadge(status)}</td>
    ${showActions ? `<td>
      <div class="row-actions">
        <button class="row-btn" data-action="payment-receipt" data-id="${p.id}">Recibo</button>
        <button class="row-btn danger" data-action="payment-delete" data-id="${p.id}" data-member="${esc(m.name)}">Eliminar</button>
      </div>
    </td>` : '<td></td>'}
  </tr>`;
}

$('#paymentSearch')?.addEventListener('input', renderPayments);
$('#paymentMonthFilter')?.addEventListener('change', renderPayments);

// Payment modal
function populatePaymentMemberSelect(preselect = null) {
  const sel = $('#paymentMember');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Selecciona un socio —</option>' +
    (db.members || []).filter(m => m.active).sort((a, b) => a.name.localeCompare(b.name)).map(m =>
      `<option value="${m.id}">${esc(m.name)}</option>`
    ).join('');
  if (preselect) sel.value = preselect;
}

function populatePaymentPlanSelect() {
  const sel = $('#paymentPlan');
  if (!sel) return;
  const plans = db.plans || [];
  sel.innerHTML = plans.map(p =>
    `<option value="${esc(p.name)}" data-price="${p.price}" data-days="${p.days}">${esc(p.name)} — ${money(p.price)}</option>`
  ).join('');
  if (plans.length > 0) autoFillPlanData();
}

function autoFillPlanData() {
  const planSel = $('#paymentPlan');
  if (!planSel) return;
  const opt = planSel.selectedOptions[0];
  if (!opt) return;
  const price = opt.dataset.price;
  const days  = Number(opt.dataset.days || 30);
  const amountEl = $('#paymentAmount');
  if (amountEl && price) amountEl.value = price;
  const pd = $('#paymentDate')?.value || today();
  const due = new Date(pd + 'T12:00:00');
  due.setDate(due.getDate() + days);
  const dueDateEl = $('#paymentDueDate');
  if (dueDateEl) dueDateEl.value = due.toISOString().slice(0, 10);
}

$('#paymentPlan')?.addEventListener('change', autoFillPlanData);
$('#paymentDate')?.addEventListener('change', autoFillPlanData);

function openPaymentModal(preselectedMemberId = null) {
  if (!db) return;
  populatePaymentMemberSelect(preselectedMemberId);
  populatePaymentPlanSelect();
  const dateEl = $('#paymentDate');
  if (dateEl) dateEl.value = today();
  autoFillPlanData();
  openModal('paymentModal');
}




const paymentForm = $('#paymentForm');
if (paymentForm) {
  paymentForm.onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    if (!data.memberId) { toast('Selecciona un socio', 'error'); return; }
    const submitBtn = paymentForm.querySelector('[type=submit]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Guardando...'; }
    try {
      await window.gymApi.addPayment(data);
      closeModal('paymentModal');
      await refresh();
      toast('Pago registrado correctamente');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Guardar pago →'; }
    }
  };
}

// Receipt
function showReceipt(paymentId) {
  const p = (db.payments || []).find(x => x.id === paymentId);
  if (!p) return;
  const m = (db.members || []).find(x => x.id === p.memberId) || { name: 'Socio eliminado', phone: '—' };
  const gymName = db.gym?.name || 'NovaFit';
  const folio   = p.id.split('-').slice(-1)[0].toUpperCase();

  $('#receiptContent').innerHTML = `
    <div class="receipt">
      <div class="receipt-header">
        <div style="font-size:1.6rem;font-weight:900;letter-spacing:.1em">${esc(gymName)}</div>
        <p style="font-size:.75rem;letter-spacing:.12em;color:var(--text3);margin:6px 0">RECIBO DE PAGO DE MEMBRESÍA</p>
        ${db.gym?.address ? `<small>${esc(db.gym.address)}</small><br>` : ''}
        ${db.gym?.phone ? `<small>Tel: ${esc(db.gym.phone)}</small>` : ''}
      </div>
      <div class="receipt-body">
        <div class="receipt-row"><span>Folio</span><span>#${folio}</span></div>
        <div class="receipt-row"><span>Fecha de emisión</span><span>${new Date().toLocaleDateString('es-MX')}</span></div>
        <div class="receipt-row"><span style="border-top:1px dashed var(--border2);margin-top:4px;padding-top:8px;display:block"> </span></div>
        <div class="receipt-row"><span>Socio</span><strong>${esc(m.name)}</strong></div>
        <div class="receipt-row"><span>Teléfono</span><span>${esc(m.phone || '—')}</span></div>
        <div class="receipt-row"><span>Plan</span><span>${esc(p.plan)}</span></div>
        <div class="receipt-row"><span>Método de pago</span><span>${esc(p.method || 'Efectivo')}</span></div>
        <div class="receipt-row"><span>Fecha de pago</span><span>${fmtDate(p.paymentDate)}</span></div>
        <div class="receipt-row"><span>Válido hasta</span><strong>${fmtDate(p.dueDate)}</strong></div>
        ${p.notes ? `<div class="receipt-row"><span>Notas</span><span>${esc(p.notes)}</span></div>` : ''}
        <div class="receipt-row total"><span>TOTAL</span><span style="color:var(--green);font-size:1.2rem">${money(p.amount)}</span></div>
      </div>
      <div class="receipt-footer">
        <p>Generado: ${new Date().toLocaleString('es-MX')}</p>
        <p style="margin-top:12px;font-size:.9rem">¡Gracias por tu preferencia! 💪</p>
      </div>
    </div>`;
  openModal('receiptModal');
}

// ─── ACCESS ───────────────────────────────────────────────────────────────────
function renderAccess() {
  const log = (db.accessLog || []).slice(0, 60);
  const logEl = $('#accessLog');
  if (!logEl) return;
  if (log.length === 0) {
    logEl.innerHTML = '<p style="text-align:center;padding:32px;color:var(--text3)">Sin registros de acceso.</p>';
    return;
  }
  logEl.innerHTML = log.map(a => {
    const m = (db.members || []).find(x => x.id === a.memberId);
    return `<div class="access-log-item">
      <div class="access-log-dot ${a.allowed ? 'log-allowed' : 'log-denied'}"></div>
      <div class="access-log-name">${esc(m?.name || a.biometricId || '—')}</div>
      <small class="access-log-meta">${new Date(a.timestamp).toLocaleString('es-MX')}</small>
      <small style="color:var(--text3)">${esc(a.reason)}</small>
      ${a.allowed ? statusBadge('vigente') : statusBadge('vencido')}
    </div>`;
  }).join('');
}

const accessForm = $('#accessForm');
if (accessForm) {
  accessForm.onsubmit = async e => {
    e.preventDefault();
    const bioId = new FormData(e.target).get('biometricId')?.trim();
    if (!bioId) return;
    try {
      const result = await window.gymApi.verifyAccess(bioId);
      const out = $('#accessResult');
      if (!out) return;

      if (result.allowed) {
        out.className = 'access-result granted';
        out.innerHTML = `<div class="access-result-inner">
          <div class="access-status-icon" style="color:var(--green)">✓</div>
          <strong>ACCESO AUTORIZADO</strong>
          <span>${esc(result.member?.name || '')} — Membresía vigente</span>
        </div>`;
      } else {
        out.className = 'access-result denied';
        out.innerHTML = `<div class="access-result-inner">
          <div class="access-status-icon" style="color:var(--red)">✕</div>
          <strong>ACCESO DENEGADO</strong>
          <span>${esc(result.reason)}</span>
        </div>`;
      }

      e.target.reset();
      await refresh();

      setTimeout(() => {
        if (out) {
          out.className = 'access-result idle';
          out.innerHTML = `<div class="access-result-inner">
            <div class="access-status-icon">⌁</div>
            <strong>Esperando lectura...</strong>
            <span>Ingresa un ID biométrico para continuar</span>
          </div>`;
        }
      }, 5000);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

$('#clearAccessBtn')?.addEventListener('click', () => {
  showConfirm('Limpiar registro de accesos', '¿Deseas eliminar todo el historial de accesos? Esta acción es permanente.', async () => {
    await window.gymApi.clearAccessLog();
    await refresh();
    toast('Historial de accesos limpiado');
  });
});

// ─── STAFF ────────────────────────────────────────────────────────────────────
function renderStaff() {
  const users = db.users || [];
  const tbody = $('#staffTable');
  if (!tbody) return;
  if (users.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6"><span class="empty-icon">♜</span>Sin colaboradores registrados.</td></tr>`;
    return;
  }
  tbody.innerHTML = users.map(u => `<tr>
    <td><code>${esc(u.username)}</code></td>
    <td>
      <div class="member-cell">
        <div class="user-avatar" style="background:${avatarColor(u.name)};width:30px;height:30px;font-size:.65rem;flex-shrink:0">${initials(u.name)}</div>
        <strong style="color:var(--text);font-size:.83rem">${esc(u.name)}</strong>
      </div>
    </td>
    <td><span class="badge ${u.role === 'owner' ? 'badge-purple' : 'badge-blue'}">${u.role === 'owner' ? '⭐ Dueño' : 'Recepcionista'}</span></td>
    <td style="font-size:.78rem;color:var(--text2)">${fmtDate(u.createdAt || '')}</td>
    <td>${u.active ? statusBadge('vigente') : statusBadge('vencido')}</td>
    <td>
      <div class="row-actions">
        ${u.role !== 'owner'
          ? `<button class="row-btn ${!u.active ? '' : ''}" data-action="staff-toggle" data-id="${u.id}" data-name="${esc(u.name)}" data-active="${u.active}">${u.active ? 'Desactivar' : 'Activar'}</button>
             <button class="row-btn" data-action="staff-reset-pass" data-id="${u.id}">Reset pass</button>`
          : `<small style="color:var(--text3);font-size:.72rem">Admin principal</small>`
        }
      </div>
    </td>
  </tr>`).join('');
}

const staffForm = $('#staffForm');
if (staffForm) {
  staffForm.onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const submitBtn = staffForm.querySelector('[type=submit]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creando...'; }
    try {
      await window.gymApi.addUser(data);
      e.target.reset();
      closeModal('staffModal');
      await refresh();
      toast('Recepcionista creado correctamente');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Crear recepcionista →'; }
    }
  };
}

const resetPasswordForm = $('#resetPasswordForm');
if (resetPasswordForm) {
  resetPasswordForm.onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      await window.gymApi.resetPassword({ userId: data.userId, newPassword: data.newPassword });
      e.target.reset();
      closeModal('resetPasswordModal');
      toast('Contraseña reseteada correctamente');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function renderSettings() {
  if (!db || !db.gym) return;
  const g = db.gym;
  const set = (id, val) => { const el = $(id); if (el) el.value = val || ''; };
  set('#gymName',     g.name);
  set('#gymOwner',    g.owner);
  set('#gymPhone',    g.phone);
  set('#gymEmail',    g.email);
  set('#gymAddress',  g.address);
  set('#gymCurrency', g.currency || 'MXN');
  renderPlansList();
}

const gymForm = $('#gymForm');
if (gymForm) {
  gymForm.onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      await window.gymApi.updateGym(data);
      await refresh();
      toast('Configuración guardada correctamente');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

const passwordForm = $('#passwordForm');
if (passwordForm) {
  passwordForm.onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    if (data.newPassword !== data.confirmPassword) {
      toast('Las contraseñas nuevas no coinciden', 'error'); return;
    }
    if (data.newPassword.length < 6) {
      toast('La contraseña debe tener al menos 6 caracteres', 'error'); return;
    }
    try {
      await window.gymApi.changePassword({
        userId: currentUser.id,
        currentPassword: data.currentPassword,
        newPassword: data.newPassword
      });
      e.target.reset();
      toast('Contraseña actualizada correctamente');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

// Plans
function renderPlansList() {
  const plans = db.plans || [];
  const el = $('#plansList');
  if (!el) return;
  el.innerHTML = plans.map((p, i) => `
    <div class="plan-item" data-idx="${i}">
      <input class="plan-name"  value="${esc(p.name)}"  placeholder="Nombre del plan"  style="font-weight:600">
      <input class="plan-price" value="${p.price}" type="number" min="0" step="0.01" placeholder="Precio" style="width:110px">
      <input class="plan-days"  value="${p.days}"  type="number" min="1" placeholder="Días"  style="width:80px">
      <button class="plan-remove" data-remove="${i}" title="Eliminar plan">✕</button>
    </div>`).join('');
}

$('#plansList')?.addEventListener('click', e => {
  if (e.target.dataset.remove !== undefined) {
    const idx = Number(e.target.dataset.remove);
    db.plans.splice(idx, 1);
    renderPlansList();
  }
});

$('#addPlanBtn')?.addEventListener('click', () => {
  if (!db.plans) db.plans = [];
  db.plans.push({ id: `plan-${Date.now()}`, name: 'Nuevo plan', price: 0, days: 30 });
  renderPlansList();
});

$('#savePlansBtn')?.addEventListener('click', async () => {
  const items = $$('#plansList .plan-item');
  const plans = items.map(item => ({
    id: `plan-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    name:  item.querySelector('.plan-name')?.value?.trim() || '',
    price: Number(item.querySelector('.plan-price')?.value || 0),
    days:  Number(item.querySelector('.plan-days')?.value  || 30),
  })).filter(p => p.name);
  try {
    await window.gymApi.updatePlans(plans);
    await refresh();
    toast('Planes guardados correctamente');
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#backupBtn')?.addEventListener('click', async () => {
  const r = await window.gymApi.backup();
  if (r.success) toast('Backup guardado correctamente ✓');
});

$('#restoreBtn')?.addEventListener('click', () => {
  showConfirm(
    'Restaurar desde backup',
    '¿Deseas reemplazar TODOS los datos actuales con el backup seleccionado?',
    async () => {
      const r = await window.gymApi.restore();
      if (r.success) { await refresh(); toast('Datos restaurados correctamente'); }
    }
  );
});

// ─── CSV Exports ──────────────────────────────────────────────────────────────
$('#exportMembersBtn')?.addEventListener('click', async () => {
  const r = await window.gymApi.exportCsv('members');
  if (r.success) toast('Lista de socios exportada ✓');
});
$('#exportPaymentsBtn')?.addEventListener('click', async () => {
  const r = await window.gymApi.exportCsv('payments');
  if (r.success) toast('Pagos exportados ✓');
});
$('#exportAccessBtn')?.addEventListener('click', async () => {
  const r = await window.gymApi.exportCsv('access');
  if (r.success) toast('Log de accesos exportado ✓');
});

// ─── Window resize → redraw chart ─────────────────────────────────────────────
window.addEventListener('resize', () => {
  if (currentView === 'overview' && db) renderIncomeChart();
});

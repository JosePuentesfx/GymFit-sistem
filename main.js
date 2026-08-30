const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Password helpers ────────────────────────────────────────────────────────
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function matchesPassword(password, stored) {
  const [salt, hash] = (stored || '').split(':');
  try {
    return !!salt && crypto.timingSafeEqual(
      Buffer.from(hash, 'hex'),
      crypto.scryptSync(password, salt, 64)
    );
  } catch { return false; }
}

// ─── Default data ────────────────────────────────────────────────────────────
const initialData = {
  gym: {
    name: 'NovaFit', owner: 'Admin',
    address: '', phone: '', email: '',
    currency: 'MXN', timezone: 'America/Mexico_City', logo: null
  },
  plans: [
    { id: 'plan-mensual',    name: 'Mensual',    price: 550,  days: 30  },
    { id: 'plan-trimestral', name: 'Trimestral', price: 1500, days: 90  },
    { id: 'plan-semestral',  name: 'Semestral',  price: 2800, days: 180 },
    { id: 'plan-anual',      name: 'Anual',      price: 5000, days: 365 },
    { id: 'plan-estudiante', name: 'Estudiante', price: 400,  days: 30  },
    { id: 'plan-premium',    name: 'Premium',    price: 800,  days: 30  },
  ],
  users: [{
    id: 'owner-1', name: 'Administrador',
    username: 'admin', passwordHash: null,
    role: 'owner', active: true,
    createdAt: new Date().toISOString()
  }],
  members: [], payments: [], accessLog: []
};

let dbPath;
let mainWin  = null;
let termWin  = null;

// ─── Session management ────────────────────────────────────────────────────────
// Track authenticated sessions by webContents id so IPC handlers can enforce
// authorization (role checks) server-side instead of trusting the renderer.
const sessions = new Map(); // id -> { user, lastActivity }

function getSession(event) {
  const s = sessions.get(event.sender.id);
  return s && s.user.active ? s : null;
}
function requireSession(event) {
  const s = getSession(event);
  if (!s) throw new Error('No autenticado. Inicia sesión de nuevo.');
  return s;
}
function requireRole(event, role) {
  const s = requireSession(event);
  if (s.user.role !== role) throw new Error('No autorizado: se requiere rol de dueño.');
  return s;
}

// ─── Rate limiting ─────────────────────────────────────────────────────────────
const failedLogins  = new Map(); // fingerprint -> { count, until }
const failedAccess  = new Map(); // key -> { count, until }
const MAX_LOGIN_ATTEMPTS = 5;
const MAX_ACCESS_ATTEMPTS = 8;
const LOCK_WINDOW_MS = 15 * 60 * 1000;

function isLocked(fingerprint, map) {
  const e = map.get(fingerprint);
  if (!e) return false;
  if (Date.now() > e.until) { map.delete(fingerprint); return false; }
  return true;
}
function recordFailure(fingerprint, map, max) {
  const e = map.get(fingerprint) || { count: 0, until: 0 };
  e.count += 1;
  if (e.count >= max) e.until = Date.now() + LOCK_WINDOW_MS;
  map.set(fingerprint, e);
  return e;
}
function resetFailures(fingerprint, map) { map.delete(fingerprint); }

function readDb() {
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch {
    const data = structuredClone(initialData);
    data.users[0].passwordHash = hashPassword('admin123');
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    return data;
  }
}

function saveDb(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
  // Notify terminal window of DB update
  if (termWin && !termWin.isDestroyed()) {
    termWin.webContents.send('db:updated');
  }
  return data;
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Create windows ──────────────────────────────────────────────────────────
function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0d1117',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWin.loadFile('index.html');
  mainWin.on('closed', () => { mainWin = null; });
}

function createTerminalWindow() {
  termWin = new BrowserWindow({
    fullscreen: true,
    backgroundColor: '#0d1117',
    frame: false,
    alwaysOnTop: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'access-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'NovaFit — Terminal de Acceso'
  });
  termWin.loadFile('access-terminal.html');
  termWin.on('closed', () => { termWin = null; });
}

app.whenReady().then(() => {
  dbPath = path.join(app.getPath('userData'), 'novafit-data.json');
  createMainWindow();
  // Small delay so main window appears first
  setTimeout(createTerminalWindow, 600);
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) {
      createMainWindow();
      setTimeout(createTerminalWindow, 600);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── Window controls — Main ──────────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWin?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWin?.isMaximized()) mainWin.unmaximize(); else mainWin?.maximize();
});
ipcMain.on('window:close', () => mainWin?.close());

// ─── Window controls — Terminal ──────────────────────────────────────────────
ipcMain.on('terminal:minimize',   () => termWin?.minimize());
ipcMain.on('terminal:close',      () => termWin?.hide());
ipcMain.on('terminal:fullscreen', () => {
  if (termWin) termWin.setFullScreen(!termWin.isFullScreen());
});

// ─── Show/hide terminal from main window ────────────────────────────────────
ipcMain.on('terminal:toggle', () => {
  if (!termWin || termWin.isDestroyed()) { createTerminalWindow(); return; }
  if (termWin.isVisible()) termWin.hide(); else termWin.show();
});
ipcMain.handle('terminal:isVisible', () => {
  return termWin && !termWin.isDestroyed() && termWin.isVisible();
});

// ─── DB ──────────────────────────────────────────────────────────────────────
ipcMain.handle('db:get', (event) => {
  requireSession(event);
  const data = readDb();
  return { ...data, users: data.users.map(({ password, passwordHash, ...u }) => u) };
});

// Public, limited data for the unauthenticated access terminal (kiosk).
ipcMain.handle('gym:getPublic', () => {
  const db = readDb();
  return { gym: db.gym ? { name: db.gym.name, logo: db.gym.logo } : {} };
});

// Clean up session when its window is closed.
app.on('web-contents-created', (_e, wc) => {
  wc.on('destroyed', () => sessions.delete(wc.id));
});

// ─── Auth ─────────────────────────────────────────────────────────────────────
ipcMain.handle('auth:login', (event, creds) => {
  const fingerprint = String((creds && creds.username) || '');
  if (isLocked(fingerprint, failedLogins))
    throw new Error('Demasiados intentos fallidos. Cuenta bloqueada 15 minutos.');

  const db = readDb();
  const user = db.users.find(u => u.username === creds.username && u.active);
  // Eliminado el backdoor legacy de texto plano: solo se acepta passwordHash scrypt.
  const valid = !!user && !!user.passwordHash && matchesPassword(creds.password, user.passwordHash);
  if (valid) {
    resetFailures(fingerprint, failedLogins);
    sessions.set(event.sender.id, { user, lastActivity: Date.now() });
    return (({ password, passwordHash, ...safe }) => safe)(user);
  }
  recordFailure(fingerprint, failedLogins, MAX_LOGIN_ATTEMPTS);
  return null;
});

// ─── Session / authorization guards used by data handlers ─────────────────────
ipcMain.handle('session:logout', (event) => {
  sessions.delete(event.sender.id);
  return true;
});

// ─── Users / Staff (owner only) ────────────────────────────────────────────────
ipcMain.handle('user:add', (event, payload) => {
  requireRole(event, 'owner');
  const db = readDb();
  if (db.users.some(u => u.username === payload.username))
    throw new Error('Ese nombre de usuario ya existe.');
  const { password, ...rest } = payload;
  db.users.push({
    id: uid('user'), ...rest,
    passwordHash: hashPassword(password),
    role: 'receptionist', active: true,
    createdAt: new Date().toISOString()
  });
  return saveDb(db);
});

ipcMain.handle('user:toggle', (event, userId) => {
  requireRole(event, 'owner');
  const db = readDb();
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('Usuario no encontrado.');
  if (user.role === 'owner') throw new Error('No se puede desactivar al dueño.');
  user.active = !user.active;
  if (!user.active) { for (const [wcId, s] of sessions) if (s.user.id === user.id) sessions.delete(wcId); }
  return saveDb(db);
});

ipcMain.handle('user:resetPassword', (event, { userId, newPassword }) => {
  requireRole(event, 'owner');
  if (typeof newPassword !== 'string' || newPassword.length < 6)
    throw new Error('La contraseña debe tener al menos 6 caracteres.');
  const db = readDb();
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('Usuario no encontrado.');
  user.passwordHash = hashPassword(newPassword);
  return saveDb(db);
});

ipcMain.handle('user:changePassword', (event, { userId, currentPassword, newPassword }) => {
  if (typeof newPassword !== 'string' || newPassword.length < 6)
    throw new Error('La contraseña debe tener al menos 6 caracteres.');
  const s = requireSession(event);
  if (s.user.id !== userId) throw new Error('Solo puedes cambiar tu propia contraseña.');
  const db = readDb();
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('Usuario no encontrado.');
  if (!matchesPassword(currentPassword, user.passwordHash))
    throw new Error('Contraseña actual incorrecta.');
  user.passwordHash = hashPassword(newPassword);
  return saveDb(db);
});

// ─── Member data handlers (require authenticated session) ─────────────────────
const str = (v, max = 500) => (v === undefined || v === null ? '' : String(v).slice(0, max));

ipcMain.handle('member:add', (event, payload) => {
  requireSession(event);
  if (!payload || !String(payload.name || '').trim())
    throw new Error('El nombre del socio es obligatorio.');
  const db = readDb();
  if (payload.biometricId && db.members.some(m => m.biometricId === payload.biometricId && m.active))
    throw new Error('Ese ID / PIN ya está registrado en otro socio.');
  db.members.push({
    id: uid('member'),
    createdAt: new Date().toISOString(),
    active: true,
    biometricId:      str(payload.biometricId, 20) || null,
    name:             str(payload.name, 120),
    phone:            str(payload.phone, 40),
    email:            str(payload.email, 120),
    address:          str(payload.address, 250),
    birthdate:        str(payload.birthdate, 10),
    emergencyContact: str(payload.emergencyContact, 120),
    notes:            str(payload.notes, 1000)
  });
  return saveDb(db);
});

ipcMain.handle('member:update', (event, { id, ...payload }) => {
  requireSession(event);
  if (payload.name !== undefined && !String(payload.name || '').trim())
    throw new Error('El nombre del socio es obligatorio.');
  const db = readDb();
  const idx = db.members.findIndex(m => m.id === id);
  if (idx === -1) throw new Error('Socio no encontrado.');
  if (payload.biometricId && db.members.some(m => m.biometricId === payload.biometricId && m.id !== id && m.active))
    throw new Error('Ese ID / PIN ya está registrado en otro socio.');
  const clean = {};
  for (const [k, v] of Object.entries(payload)) clean[k] = str(v, 1000);
  db.members[idx] = { ...db.members[idx], ...clean, updatedAt: new Date().toISOString() };
  return saveDb(db);
});

ipcMain.handle('member:delete', (event, memberId) => {
  requireRole(event, 'owner');
  const db = readDb();
  const idx = db.members.findIndex(m => m.id === memberId);
  if (idx === -1) throw new Error('Socio no encontrado.');
  db.members[idx].active    = false;
  db.members[idx].deletedAt = new Date().toISOString();
  return saveDb(db);
});

// ─── Payments ─────────────────────────────────────────────────────────────────
ipcMain.handle('payment:add', (event, payload) => {
  requireSession(event);
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error('El monto del pago debe ser un número mayor a 0.');
  const db = readDb();
  db.payments.unshift({
    id: uid('payment'),
    createdAt:   new Date().toISOString(),
    memberId:    str(payload.memberId, 64),
    plan:        str(payload.plan, 120),
    amount,
    paymentDate: str(payload.paymentDate, 10),
    dueDate:     str(payload.dueDate, 10),
    method:      str(payload.method, 40) || 'Efectivo',
    notes:       str(payload.notes, 1000)
  });
  return saveDb(db);
});

ipcMain.handle('payment:delete', (event, paymentId) => {
  requireSession(event);
  const db = readDb();
  const idx = db.payments.findIndex(p => p.id === paymentId);
  if (idx === -1) throw new Error('Pago no encontrado.');
  db.payments.splice(idx, 1);
  return saveDb(db);
});

// ─── Access ───────────────────────────────────────────────────────────────────
ipcMain.handle('access:verify', (_, biometricId) => {
  const key = String(biometricId || '').trim();
  if (isLocked(key, failedAccess))
    throw new Error('Demasiados intentos. Intenta de nuevo en 15 minutos.');

  const db = readDb();
  const member = db.members.find(m => m.biometricId === key && m.active);
  if (!member) { recordFailure(key, failedAccess, MAX_ACCESS_ATTEMPTS); }
  const today  = new Date().toISOString().slice(0, 10);
  const lastPay = member
    ? db.payments
        .filter(p => p.memberId === member.id)
        .sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0]
    : null;
  const paid = lastPay && lastPay.dueDate >= today;
  const event = {
    id:          uid('access'),
    timestamp:   new Date().toISOString(),
    biometricId: key,
    memberId:    member?.id  || null,
    allowed:     !!paid,
    reason:      !member ? 'ID no registrado' : paid ? 'Membresía vigente' : 'Membresía vencida'
  };
  db.accessLog.unshift(event);
  saveDb(db);
  return { ...event, member: member ? { id: member.id, name: member.name } : null };
});

ipcMain.handle('access:clearLog', (event) => {
  requireRole(event, 'owner');
  const db = readDb();
  db.accessLog = [];
  return saveDb(db);
});

// ─── Plans ────────────────────────────────────────────────────────────────────
ipcMain.handle('plans:update', (event, plans) => {
  requireRole(event, 'owner');
  if (!Array.isArray(plans)) throw new Error('Formato de planes inválido.');
  const db = readDb();
  db.plans = plans.map(p => ({
    id:    str(p.id, 64) || `plan-${Date.now()}`,
    name:  str(p.name, 80),
    price: Math.max(0, Number(p.price) || 0),
    days:  Math.max(1, Math.min(3650, Math.floor(Number(p.days) || 30)))
  })).filter(p => p.name);
  return saveDb(db);
});

// ─── Gym config ───────────────────────────────────────────────────────────────
ipcMain.handle('gym:update', (event, config) => {
  requireRole(event, 'owner');
  const db = readDb();
  const clean = {};
  for (const [k, v] of Object.entries(config || {})) clean[k] = str(v, 250);
  db.gym = { ...db.gym, ...clean };
  return saveDb(db);
});

// ─── Data export ──────────────────────────────────────────────────────────────
ipcMain.handle('data:exportCsv', async (event, { type }) => {
  requireSession(event);
  const db = readDb();
  let csv = '';
  const safe = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

  if (type === 'members') {
    csv = 'ID,Nombre,Teléfono,Correo,ID-PIN,Fecha registro,Estado\n';
    csv += db.members.filter(m => m.active).map(m =>
      [m.id, m.name, m.phone, m.email, m.biometricId || '', m.createdAt.slice(0,10), 'Activo']
        .map(safe).join(',')
    ).join('\n');
  } else if (type === 'payments') {
    csv = 'ID,Socio,Plan,Monto,Fecha pago,Vence,Método\n';
    csv += db.payments.map(p => {
      const m = db.members.find(x => x.id === p.memberId);
      return [p.id, m?.name || 'Eliminado', p.plan, p.amount, p.paymentDate, p.dueDate, p.method]
        .map(safe).join(',');
    }).join('\n');
  } else if (type === 'access') {
    csv = 'Timestamp,ID-PIN,Socio,Resultado,Razón\n';
    csv += db.accessLog.map(a => {
      const m = db.members.find(x => x.id === a.memberId);
      return [a.timestamp, a.biometricId, m?.name || '—', a.allowed ? 'Permitido' : 'Denegado', a.reason]
        .map(safe).join(',');
    }).join('\n');
  }

  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Exportar CSV',
    defaultPath: path.join(app.getPath('documents'), `novafit_${type}_${new Date().toISOString().slice(0,10)}.csv`),
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (!canceled && filePath) {
    fs.writeFileSync(filePath, '\ufeff' + csv, 'utf8');
    shell.openPath(path.dirname(filePath));
    return { success: true, filePath };
  }
  return { success: false };
});

ipcMain.handle('data:backup', async (event) => {
  requireRole(event, 'owner');
  const db = readDb();
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Guardar backup',
    defaultPath: path.join(app.getPath('documents'), `novafit_backup_${new Date().toISOString().slice(0,10)}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (!canceled && filePath) {
    fs.writeFileSync(filePath, JSON.stringify(db, null, 2), 'utf8');
    return { success: true, filePath };
  }
  return { success: false };
});

// ─── Granular validation for restored backups ─────────────────────────────────
function sanitizeRestored(data) {
  if (!data || typeof data !== 'object') throw new Error('Archivo inválido');
  if (!Array.isArray(data.users) || !Array.isArray(data.members) || !Array.isArray(data.payments))
    throw new Error('Estructura del backup inválida');

  const clean = {
    gym: { name: 'NovaFit', owner: 'Admin', address: '', phone: '', email: '',
           currency: 'MXN', timezone: 'America/Mexico_City', logo: null, ...(data.gym || {}) },
    plans: Array.isArray(data.plans) ? data.plans : initialData.plans,
    users: [],
    members: [],
    payments: [],
    accessLog: Array.isArray(data.accessLog) ? data.accessLog : []
  };

  // Users: force valid, non-empty password hashes; neutralize role escalation.
  const seenUsernames = new Set();
  for (const u of data.users) {
    if (!u || typeof u.username !== 'string' || !u.username.trim()) continue;
    if (seenUsernames.has(u.username)) continue;
    seenUsernames.add(u.username);
    const isOwner = u.role === 'owner';
    if (isOwner && clean.users.some(x => x.role === 'owner')) continue; // keep existing owner
    clean.users.push({
      id: u.id || uid('user'),
      name: str(u.name, 120) || u.username,
      username: u.username.trim(),
      role: isOwner ? 'owner' : 'receptionist',
      active: !!u.active,
      createdAt: typeof u.createdAt === 'string' ? u.createdAt : new Date().toISOString(),
      passwordHash: typeof u.passwordHash === 'string' && u.passwordHash.includes(':')
        ? u.passwordHash
        : hashPassword(u.username + 'novafit')
    });
  }
  // Ensure at least one owner always exists.
  if (!clean.users.some(u => u.role === 'owner')) {
    const owner = initialData.users[0];
    clean.users.unshift({ ...owner, passwordHash: hashPassword('admin123') });
  }

  for (const m of data.members) {
    if (!m || !m.name) continue;
    clean.members.push({
      id: m.id || uid('member'),
      createdAt: typeof m.createdAt === 'string' ? m.createdAt : new Date().toISOString(),
      active: m.active !== false,
      biometricId: str(m.biometricId, 20) || null,
      name: str(m.name, 120), phone: str(m.phone, 40), email: str(m.email, 120),
      address: str(m.address, 250), birthdate: str(m.birthdate, 10),
      emergencyContact: str(m.emergencyContact, 120), notes: str(m.notes, 1000)
    });
  }

  for (const p of data.payments) {
    if (!p || !p.memberId) continue;
    clean.payments.push({
      id: p.id || uid('payment'),
      createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
      memberId: str(p.memberId, 64), plan: str(p.plan, 120),
      amount: Math.max(0, Number(p.amount) || 0),
      paymentDate: str(p.paymentDate, 10), dueDate: str(p.dueDate, 10),
      method: str(p.method, 40) || 'Efectivo', notes: str(p.notes, 1000)
    });
  }
  return clean;
}

ipcMain.handle('data:restore', async (event) => {
  requireRole(event, 'owner');
  const { filePaths, canceled } = await dialog.showOpenDialog({
    title: 'Restaurar backup',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (!canceled && filePaths[0]) {
    try {
      const data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
      saveDb(sanitizeRestored(data));
      return { success: true };
    } catch {
      throw new Error('El archivo de backup no es válido.');
    }
  }
  return { success: false };
});

ipcMain.handle('data:stats', (event) => {
  requireSession(event);
  const db   = readDb();
  const now  = new Date();
  const today = now.toISOString().slice(0, 10);
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.toISOString().slice(0, 7);
    const label = d.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' });
    const income = db.payments.filter(p => p.paymentDate.startsWith(key)).reduce((a, p) => a + Number(p.amount), 0);
    months.push({ key, label, income });
  }
  const activeMembers = db.members.filter(m => {
    if (!m.active) return false;
    const lp = db.payments.filter(p => p.memberId === m.id).sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0];
    return lp && lp.dueDate >= today;
  });
  const thisMonth = now.toISOString().slice(0, 7);
  const revenue   = db.payments.filter(p => p.paymentDate.startsWith(thisMonth)).reduce((a, p) => a + Number(p.amount), 0);
  return { months, activeMembers: activeMembers.length, revenue, totalMembers: db.members.filter(m => m.active).length };
});

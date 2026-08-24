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
ipcMain.handle('db:get', () => {
  const data = readDb();
  return { ...data, users: data.users.map(({ password, passwordHash, ...u }) => u) };
});

// ─── Auth ─────────────────────────────────────────────────────────────────────
ipcMain.handle('auth:login', (_, creds) => {
  const db = readDb();
  const user = db.users.find(u => u.username === creds.username && u.active);
  if (!user) return null;
  const valid = user.passwordHash
    ? matchesPassword(creds.password, user.passwordHash)
    : (user.password === creds.password);
  if (valid && user.password) {
    user.passwordHash = hashPassword(user.password);
    delete user.password;
    saveDb(db);
  }
  return valid ? (({ password, passwordHash, ...safe }) => safe)(user) : null;
});

// ─── Users / Staff ────────────────────────────────────────────────────────────
ipcMain.handle('user:add', (_, payload) => {
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

ipcMain.handle('user:toggle', (_, userId) => {
  const db = readDb();
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('Usuario no encontrado.');
  if (user.role === 'owner') throw new Error('No se puede desactivar al dueño.');
  user.active = !user.active;
  return saveDb(db);
});

ipcMain.handle('user:resetPassword', (_, { userId, newPassword }) => {
  const db = readDb();
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('Usuario no encontrado.');
  user.passwordHash = hashPassword(newPassword);
  return saveDb(db);
});

ipcMain.handle('user:changePassword', (_, { userId, currentPassword, newPassword }) => {
  const db = readDb();
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('Usuario no encontrado.');
  if (!matchesPassword(currentPassword, user.passwordHash))
    throw new Error('Contraseña actual incorrecta.');
  user.passwordHash = hashPassword(newPassword);
  return saveDb(db);
});

// ─── Members ──────────────────────────────────────────────────────────────────
ipcMain.handle('member:add', (_, payload) => {
  const db = readDb();
  if (payload.biometricId && db.members.some(m => m.biometricId === payload.biometricId && m.active))
    throw new Error('Ese ID / PIN ya está registrado en otro socio.');
  db.members.push({
    id: uid('member'),
    createdAt: new Date().toISOString(),
    active: true,
    biometricId:      payload.biometricId || null,
    name:             payload.name,
    phone:            payload.phone,
    email:            payload.email || '',
    address:          payload.address || '',
    birthdate:        payload.birthdate || '',
    emergencyContact: payload.emergencyContact || '',
    notes:            payload.notes || ''
  });
  return saveDb(db);
});

ipcMain.handle('member:update', (_, { id, ...payload }) => {
  const db = readDb();
  const idx = db.members.findIndex(m => m.id === id);
  if (idx === -1) throw new Error('Socio no encontrado.');
  if (payload.biometricId && db.members.some(m => m.biometricId === payload.biometricId && m.id !== id && m.active))
    throw new Error('Ese ID / PIN ya está registrado en otro socio.');
  db.members[idx] = { ...db.members[idx], ...payload, updatedAt: new Date().toISOString() };
  return saveDb(db);
});

ipcMain.handle('member:delete', (_, memberId) => {
  const db = readDb();
  const idx = db.members.findIndex(m => m.id === memberId);
  if (idx === -1) throw new Error('Socio no encontrado.');
  db.members[idx].active    = false;
  db.members[idx].deletedAt = new Date().toISOString();
  return saveDb(db);
});

// ─── Payments ─────────────────────────────────────────────────────────────────
ipcMain.handle('payment:add', (_, payload) => {
  const db = readDb();
  db.payments.unshift({
    id: uid('payment'),
    createdAt:   new Date().toISOString(),
    memberId:    payload.memberId,
    plan:        payload.plan,
    amount:      Number(payload.amount),
    paymentDate: payload.paymentDate,
    dueDate:     payload.dueDate,
    method:      payload.method || 'Efectivo',
    notes:       payload.notes || ''
  });
  return saveDb(db);
});

ipcMain.handle('payment:delete', (_, paymentId) => {
  const db = readDb();
  const idx = db.payments.findIndex(p => p.id === paymentId);
  if (idx === -1) throw new Error('Pago no encontrado.');
  db.payments.splice(idx, 1);
  return saveDb(db);
});

// ─── Access ───────────────────────────────────────────────────────────────────
ipcMain.handle('access:verify', (_, biometricId) => {
  const db = readDb();
  const member = db.members.find(m => m.biometricId === biometricId && m.active);
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
    biometricId,
    memberId:    member?.id  || null,
    allowed:     !!paid,
    reason:      !member ? 'ID no registrado' : paid ? 'Membresía vigente' : 'Membresía vencida'
  };
  db.accessLog.unshift(event);
  saveDb(db);
  return { ...event, member: member ? { id: member.id, name: member.name } : null };
});

ipcMain.handle('access:clearLog', () => {
  const db = readDb();
  db.accessLog = [];
  return saveDb(db);
});

// ─── Plans ────────────────────────────────────────────────────────────────────
ipcMain.handle('plans:update', (_, plans) => {
  const db = readDb();
  db.plans = plans;
  return saveDb(db);
});

// ─── Gym config ───────────────────────────────────────────────────────────────
ipcMain.handle('gym:update', (_, config) => {
  const db = readDb();
  db.gym = { ...db.gym, ...config };
  return saveDb(db);
});

// ─── Data export ──────────────────────────────────────────────────────────────
ipcMain.handle('data:exportCsv', async (event, { type }) => {
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

ipcMain.handle('data:backup', async () => {
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

ipcMain.handle('data:restore', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog({
    title: 'Restaurar backup',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (!canceled && filePaths[0]) {
    try {
      const data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
      if (!data.members || !data.payments || !data.users) throw new Error('Archivo inválido');
      saveDb(data);
      return { success: true };
    } catch {
      throw new Error('El archivo de backup no es válido.');
    }
  }
  return { success: false };
});

ipcMain.handle('data:stats', () => {
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

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) { return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`; }
function matchesPassword(password, stored) { const [salt, hash] = (stored || '').split(':'); return !!salt && crypto.timingSafeEqual(Buffer.from(hash, 'hex'), crypto.scryptSync(password, salt, 64)); }

const initialData = {
  gym: { name: 'NovaFit', owner: 'Laura Reyes' },
  users: [{ id: 'owner-1', name: 'Laura Reyes', username: 'admin', passwordHash: null, role: 'owner', active: true }],
  members: [], payments: [], accessLog: []
};
let dbPath;
function readDb() { try { return JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch { const data = structuredClone(initialData); data.users[0].passwordHash = hashPassword('admin123'); fs.writeFileSync(dbPath, JSON.stringify(data, null, 2)); return data; } }
function saveDb(data) { fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8'); return data; }
function id(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
function createWindow() { const win = new BrowserWindow({ width: 1380, height: 850, minWidth: 1040, minHeight: 680, backgroundColor: '#f7f8fb', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } }); win.loadFile('index.html'); }
app.whenReady().then(() => { dbPath = path.join(app.getPath('userData'), 'novafit-data.json'); createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('db:get', () => { const data = readDb(); return { ...data, users: data.users.map(({ password, passwordHash, ...user }) => user) }; });
ipcMain.handle('auth:login', (_, credentials) => { const db = readDb(); const user = db.users.find(u => u.username === credentials.username && u.active); if (!user) return null; const valid = user.passwordHash ? matchesPassword(credentials.password, user.passwordHash) : user.password === credentials.password; if (valid && user.password) { user.passwordHash = hashPassword(credentials.password); delete user.password; saveDb(db); } return valid ? (({ password, passwordHash, ...safe }) => safe)(user) : null; });
ipcMain.handle('user:add', (_, payload) => { const db = readDb(); if (db.users.some(u => u.username === payload.username)) throw new Error('Ese usuario ya existe.'); const { password, ...user } = payload; db.users.push({ id: id('user'), ...user, passwordHash: hashPassword(password), role: 'receptionist', active: true }); return saveDb(db); });
ipcMain.handle('member:add', (_, payload) => { const db = readDb(); db.members.push({ id: id('member'), createdAt: new Date().toISOString(), active: true, biometricId: payload.biometricId || null, ...payload }); return saveDb(db); });
ipcMain.handle('payment:add', (_, payload) => { const db = readDb(); db.payments.unshift({ id: id('payment'), createdAt: new Date().toISOString(), ...payload }); return saveDb(db); });
ipcMain.handle('access:verify', (_, biometricId) => { const db = readDb(); const member = db.members.find(m => m.biometricId === biometricId && m.active); const today = new Date().toISOString().slice(0, 10); const paid = member && db.payments.some(p => p.memberId === member.id && p.dueDate >= today); const event = { id: id('access'), timestamp: new Date().toISOString(), biometricId, memberId: member?.id || null, allowed: !!paid, reason: !member ? 'Huella no registrada' : paid ? 'Membresía vigente' : 'Mensualidad vencida' }; db.accessLog.unshift(event); saveDb(db); return { ...event, member: member ? { id: member.id, name: member.name } : null }; });

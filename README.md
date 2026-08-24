# 🏋️ NovaFit Pro — Sistema Profesional de Gimnasio

Sistema de gestión de gimnasio desktop construido con **Electron + JavaScript + CSS puro**, con almacenamiento local (JSON) y diseño dark glassmorphism premium.

---

## 🚀 Inicio rápido

### Requisitos
- [Node.js](https://nodejs.org) v18 o superior

### Instalación
```bash
npm install
```

### Iniciar la aplicación
```
Doble clic en: INICIAR NOVAFIT.bat
```
O desde terminal:
```bash
npm start
```

### Credenciales por defecto
| Usuario | Contraseña |
|---------|-----------|
| `admin` | `admin123` |

---

## 📋 Módulos del sistema

### 📊 Dashboard
- KPIs en tiempo real: ingresos del mes, socios activos, por vencer, accesos hoy
- Gráfico de barras de ingresos por mes (últimos 6 meses)
- Lista de socios por vencer (próximos 7 días)
- Tabla de pagos recientes

### 👥 Socios
- Registro completo: nombre, teléfono, correo, fecha de nacimiento, ID biométrico, contacto de emergencia, notas
- Filtro por estado: Vigente / Por vencer / Vencido
- Búsqueda en tiempo real
- Perfil detallado con historial de pagos
- Editar socio y baja lógica
- Exportar lista a CSV

### 💳 Pagos
- Registro de mensualidades con plan, monto, método y fechas
- Autocompletado de monto y vencimiento según el plan seleccionado
- Filtro por mes
- Recibo imprimible en pantalla
- Exportar historial a CSV

### ⌁ Control de Acceso
- Validación de ID biométrico en tiempo real
- Indicador visual: AUTORIZADO (verde) / DENEGADO (rojo)
- Log completo de accesos con timestamp
- Exportar log a CSV

### 👔 Equipo
- Gestión de recepcionistas (solo dueño)
- Activar / Desactivar usuarios
- Reset de contraseña

### ⚙️ Configuración
- Nombre del gimnasio, dirección, teléfono, correo
- Configurar planes y precios personalizados
- Cambiar contraseña del usuario actual
- Backup completo en JSON
- Restaurar desde backup

---

## 💾 Almacenamiento

Los datos se guardan en:
```
Windows: C:\Users\[usuario]\AppData\Roaming\novafit-pro\novafit-data.json
```

El archivo se crea automáticamente al primera ejecución.

---

## 🔒 Seguridad

- Contraseñas hasheadas con `crypto.scryptSync` (no almacenadas en texto plano)
- IDs biométricos: solo se guarda el identificador del lector, nunca la huella real
- `contextIsolation: true` y `nodeIntegration: false` en Electron

---

## 🎨 Stack técnico

| Capa        | Tecnología            |
|-------------|----------------------|
| Desktop     | Electron v37         |
| Frontend    | HTML5 + JS Vanilla   |
| Estilos     | CSS puro (no Tailwind)|
| Almacenamiento | JSON local (fs)   |
| Fuente      | Google Fonts — Inter |

---

## 📁 Estructura del proyecto

```
gym system/
├── main.js           # Backend Electron + IPC handlers
├── preload.js        # Puente seguro renderer ↔ main
├── index.html        # Estructura de la app
├── app.js            # Lógica del renderer
├── styles.css        # Diseño premium dark
├── package.json
└── INICIAR NOVAFIT.bat
```

---

*NovaFit Pro v2.0 — Sistema profesional de gimnasio con almacenamiento local*

# INSTALLATION MANUAL (COMPLETE VERSION)

## 1. Scope

This guide explains how to install this project on another local computer, with MariaDB persistence enabled.

It covers:
- Windows desktop install using installer (`.exe`) for final users.
- Source-code install for development/testing with `npm run dev`.
- Initial users and password-recovery data available in this version.

---

## 2. Current version assumptions

This manual matches the current repository configuration:
- Frontend: Next.js + React
- Desktop: Electron
- Backend: FastAPI + SQLAlchemy
- Database: MariaDB (required in development mode)

Default backend runtime values in this version:
- `DB_DIALECT=mariadb`
- `DB_HOST=localhost`
- `DB_PORT=3306`
- `DB_USER=root`
- `DB_PASSWORD=admin`
- `DB_NAME=proyecto_universitario_db`
- `DB_REQUIRE_MARIADB=true`

---

## 3. Option A (recommended for end users): install using `.exe`

### 3.1 Build installer on source machine

From project root:

```bash
npm install
npm run dist:win
```

Expected output:
- Installer at `dist/CreditosPro-Setup-<version>.exe`

### 3.2 Install on target computer

1. Copy `CreditosPro-Setup-<version>.exe` to target PC.
2. Run installer as normal user (or admin if your policy requires it).
3. Finish NSIS wizard.
4. Launch `CreditosPro`.

### 3.3 Important behavior for installed app

- Packaged app includes backend runtime.
- In packaged mode, if MariaDB is unavailable, app can fallback gracefully.
- For strict MariaDB usage, configure environment on target PC so backend can connect to your DB host and credentials.

---

## 4. Option B (development on another local computer): source install

Use this path if you will run:
- `npm run dev`
- `npm run dev:electron`
- `npm run dev:web`

### 4.1 Prerequisites

- Windows 10/11 (64-bit)
- Node.js `>= 20.9.0`
- npm `>= 10`
- Python 3.11+
- MariaDB 10.6+ running locally or reachable on network

### 4.2 Copy source code

Copy/clone the project folder to target PC.

### 4.3 Install dependencies

From project root:

```bash
npm install
python -m pip install -r backend/requirements.txt
```

### 4.4 Configure backend environment

Create `backend/.env` from template:

```bash
copy backend\.env.example backend\.env
```

Edit `backend/.env` with your MariaDB values.

Minimal required values:

```env
API_HOST=127.0.0.1
API_PORT=8000

DB_DIALECT=mariadb
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=admin
DB_NAME=proyecto_universitario_db
DB_REQUIRE_MARIADB=true
```

### 4.5 Create database in MariaDB

Run in MariaDB client:

```sql
CREATE DATABASE IF NOT EXISTS proyecto_universitario_db;
```

### 4.6 Start app in dev desktop mode

From project root:

```bash
npm run dev
```

This command starts:
- Next.js renderer on `http://127.0.0.1:3100`
- Electron main process
- FastAPI backend as child process

---

## 5. Post-install verification checklist

After first launch:

1. Login with admin user (see section 6).
2. Open Dashboard.
3. Create:
- 1 supplier
- 1 purchase order
- 1 invoice
- 1 payment
4. Restart app.
5. Verify created records still exist.

If records disappear after restart, check:
- You are in API mode, not LOCAL fallback.
- Backend can connect to MariaDB with your configured credentials.
- MariaDB service is running.

---

## 6. Seeded users and recovery data (this version)

These users are seeded automatically if they do not exist:

1. Admin
- Name: `Juan Perez`
- Email: `juan.perez@empresa.com`
- Password: `Admin123!`

2. Finance
- Name: `Maria Lopez`
- Email: `maria.lopez@empresa.com`
- Password: `Finance123!`

3. Procura
- Name: `Carlos Ruiz`
- Email: `carlos.ruiz@empresa.com`
- Password: `Procura123!`

### 6.1 Security questions seeded in system

The backend seeds these active questions:

1. `Cual es el nombre de tu ciudad de nacimiento?`
2. `Cual fue tu primer proyecto laboral?`
3. `Cual es el nombre de tu mascota favorita?`
4. `Cual es tu pelicula favorita?`
5. `Cual es tu lugar favorito para vacacionar?`
6. `Cual fue tu primer automovil?`

### 6.2 Default recovery answers (Admin seeded account)

For the seeded admin account, the first 3 seeded questions are configured with:

1. `Admin123!`
2. `CreditosPro`
3. `Operacion`

Important:
- In this version, default seeded recovery answers are guaranteed for admin.
- Other users may require manual configuration of security questions from Settings -> Users.

---

## 7. Password recovery flow (operator procedure)

If a user forgets password:

1. Go to Login screen.
2. Click `Olvidaste tu contrasena?`
3. Enter identifier (email or username).
4. Answer configured security questions.
5. Set new password.
6. Login with new password.

If recovery fails with:
- `User has no configured security questions.`

Then:
1. Login as admin.
2. Open Settings -> Users.
3. Reset that user security questions/answers.
4. Retry recovery.

---

## 8. Troubleshooting (most common)

### Error: backend request / cannot save / data not persisted

Checks:
1. Confirm `backend/.env` DB values are correct.
2. Confirm MariaDB service is running.
3. Confirm DB exists: `proyecto_universitario_db`.
4. Confirm app is not in LOCAL fallback mode.
5. Restart `npm run dev` after changing `.env`.

### Error: `query.pageSize: Input should be less than or equal to 100`

Status:
- Fixed in current code for dashboard windows by using supported page sizes.

If still shown:
1. Stop all running app processes.
2. Run `npm run dev` again.
3. Hard refresh/reopen app window.

### Electron startup logs

Local logs path:

```text
%LOCALAPPDATA%\CreditosPro\logs\startup.log
```

Use this file to verify:
- backend spawn
- health check status
- backend exit reason

---

## 9. Recommended first-day hardening

After installing on a new computer:

1. Change default passwords for all seeded users.
2. Configure security questions for all non-admin users.
3. Replace `root/admin` DB credentials with least-privileged DB user.
4. Backup MariaDB database.


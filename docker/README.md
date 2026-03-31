# Docker Development Setup — Odoo 18 EE + Workflow Studio

## Architecture

```
┌───────────────────────────────────────┐
│  Docker: odoo-workflow-dev            │
│                                       │
│  python 3.12 + debugpy (:5678)        │
│  Mount: /opt/odoo/source  ← 18EE-NS  │
│  Mount: /opt/odoo/custom  ← addons   │
│  Port:  8069 (web), 5678 (debug)     │
└───────────┬───────────────────────────┘
            │ host.docker.internal:5432
            ▼
┌───────────────────────┐
│  Windows Host         │
│  PostgreSQL :5432     │
│  VS Code (attach)     │
└───────────────────────┘
```

## Prerequisites

- Docker Desktop for Windows
- PostgreSQL running on Windows (port 5432)
- Odoo 18 EE source at `C:\Users\ODOO\Documents\GitHub\18EE-NS`

## 1. Configure PostgreSQL on Windows

PostgreSQL phải cho phép connections từ Docker subnet.

### postgresql.conf

Mở file (thường ở `C:\Program Files\PostgreSQL\<version>\data\postgresql.conf`):

```ini
listen_addresses = '*'
```

### pg_hba.conf

Thêm dòng sau vào cuối file `pg_hba.conf`:

```
# Allow Docker containers
host    all    all    172.17.0.0/16    md5
host    all    all    172.18.0.0/16    md5
```

### Restart PostgreSQL

```powershell
Restart-Service postgresql-x64-<version>
# hoặc từ Services Manager
```

### Windows Firewall

Nếu bị block, mở PowerShell (Admin):

```powershell
New-NetFirewallRule -DisplayName "PostgreSQL Docker" -Direction Inbound -Protocol TCP -LocalPort 5432 -RemoteAddress 172.16.0.0/12 -Action Allow
```

## 2. Build & Start

```bash
# Từ root workflow_automation_builder/
docker compose build
docker compose up
```

Container sẽ hiển thị:
```
==> Starting Odoo with debugpy on port 5678 (waiting for VS Code to attach...)
```

Odoo **chờ** VS Code attach trước khi start. Attach debugger để tiếp tục.

## 3. Attach VS Code Debugger

1. Mở VS Code trong `workflow_automation_builder/`
2. Mở Run and Debug (Ctrl+Shift+D)
3. Chọn **"Docker: Odoo debug"** từ dropdown
4. Nhấn F5 (Start Debugging)

Breakpoints sẽ hoạt động cho:
- `workflow_studio/` → `/opt/odoo/custom/workflow_studio`
- `flight_json_widget/` → `/opt/odoo/custom/flight_json_widget`
- `lf_web_studio/` → `/opt/odoo/custom/lf_web_studio`
- Odoo source (18EE-NS) → `/opt/odoo/source`

## 4. Usage

### Start without debug (faster startup)

```bash
ODOO_DEBUG=0 docker compose up
```

### Run specific Odoo commands

```bash
# Update module
docker compose exec odoo python /opt/odoo/source/odoo-bin -c /etc/odoo/odoo.conf -u workflow_studio --stop-after-init

# Shell
docker compose exec odoo python /opt/odoo/source/odoo-bin shell -c /etc/odoo/odoo.conf -d hrm_pro_18
```

### View logs

```bash
docker compose logs -f odoo
```

### Rebuild after Dockerfile changes

```bash
docker compose build --no-cache
docker compose up
```

## 5. Customization

### Environment Variables (docker/.env)

| Variable | Default | Description |
|----------|---------|-------------|
| `ODOO_DEBUG` | `1` | Enable debugpy (0 = no debug) |
| `DEBUGPY_PORT` | `5678` | debugpy listen port |
| `POSTGRES_USER` | `odoo` | PostgreSQL user |
| `POSTGRES_PASSWORD` | `odoo` | PostgreSQL password |
| `POSTGRES_DB` | `hrm_pro_18` | Target database |
| `JWT_EXPIRE_TIME` | `999999` | JWT token expiry |

### Change Odoo source path

Edit `docker-compose.yml` hoặc set env var:

```bash
ODOO_SOURCE_PATH="D:/path/to/odoo" docker compose up
```

## Troubleshooting

### Container không connect được PostgreSQL

1. Verify PostgreSQL đang chạy: `Get-Service postgresql*`
2. Test từ container: `docker compose exec odoo pg_isready -h host.docker.internal -p 5432`
3. Check `pg_hba.conf` có allow Docker subnet
4. Check Windows Firewall

### debugpy timeout / VS Code không attach được

1. Verify port 5678 exposed: `docker compose ps`
2. Check container logs: `docker compose logs odoo`
3. Verify launch.json config name = "Docker: Odoo debug"

### Module not found

Check `addons_path` trong `docker/odoo.conf` bao gồm đúng paths.
Verify mounts: `docker compose exec odoo ls /opt/odoo/custom/`

## File Structure

```
workflow_automation_builder/
├── docker/
│   ├── Dockerfile                 # Container image definition
│   ├── entrypoint.sh              # Startup script (debug/run modes)
│   ├── odoo.conf                  # Odoo server configuration
│   ├── .env                       # Environment variables (gitignored)
│   ├── requirements-docker.txt    # Odoo Python dependencies
│   └── requirements-project.txt   # Project-specific dependencies
├── docker-compose.yml             # Service orchestration
└── .vscode/
    └── launch.json                # "Docker: Odoo debug" config added
```

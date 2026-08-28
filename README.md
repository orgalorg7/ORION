# Korzah CRM

A full-stack, multi-tenant SaaS CRM for managing customers **and** employees.

- **Backend:** Django 5.2 + Django REST Framework, JWT auth (SimpleJWT), shared-schema multi-tenancy
- **Frontend:** React 18 + TypeScript + Vite, TailwindCSS, TanStack Query, Zustand
- **i18n:** English & Arabic with full RTL layout support
- **Theming:** Light & dark modes (persisted, system-aware)

## Features

| Area | What's included |
|---|---|
| **SaaS core** | Self-serve workspace signup, 14-day trial, plans (Free/Pro/Business), simulated plan upgrades, per-organization data isolation, multiple orgs per user with an org switcher |
| **Team** | Roles (owner/admin/manager/member), member management, email invitations |
| **Leads** | Capture, scoring, sources, statuses, one-click conversion to contact + company + deal |
| **Contacts & Companies** | Full CRUD, tags, owners, per-record activity timeline and notes |
| **Deals** | Multiple pipelines with configurable stages, kanban board with drag & drop, won/lost tracking with reasons |
| **Activities** | Calls / emails / meetings / tasks, due dates, assignment, overdue & upcoming views |
| **Support** | Tickets with per-org numbering, priorities, categories, comment threads (incl. internal notes) |
| **Employees (HR)** | Departments, employment types, statuses, salaries, manager hierarchy / direct reports |
| **Analytics** | Dashboard with KPIs, revenue by month, pipeline by stage, lead breakdowns |
| **Settings** | Profile, password, appearance, organization, team, pipelines, tags, billing |

## Quick start

### Run everything with one command

```bash
./run.sh
```

The script installs missing backend/frontend dependencies, applies database migrations, ensures the
demo login data exists, prints the credentials, and starts both development servers. Press `Ctrl+C`
to stop them.

### Backend (port 8000)

```bash
cd backend
# venv was created with uv (Python 3.13); recreate anytime with:
#   uv venv --python 3.13 .venv && uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python manage.py migrate
.venv/bin/python manage.py seed_demo        # optional demo data
.venv/bin/python manage.py runserver
```

### Frontend (port 5173)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 — register a new workspace, or use the demo login:

- **demo@crm.com / demo1234** (owner)
- **sales@crm.com / demo1234** (manager)

## Configuration

- `backend/.env` (see `backend/.env.example`) — secret key, debug, allowed hosts, CORS. Set the
  `POSTGRES_*` variables to use PostgreSQL; otherwise SQLite is used for local development.
- `frontend/.env` (see `frontend/.env.example`) — `VITE_API_URL` if the API is not on
  `http://localhost:8000/api/v1`.

## Deploy on Railway

The root `Dockerfile` builds the React frontend and serves it together with Django through Gunicorn.
Connect this repository to a Railway service and each push to `main` will deploy automatically.

For production, set `SECRET_KEY` and `DEBUG=False` in the service variables. Add a Railway PostgreSQL
service and reference its `DATABASE_URL` from the app service for persistent data; without it, the app
falls back to ephemeral SQLite storage. Finally, generate a public domain from the service's Networking
settings. Railway supplies `PORT` and its public domain to the container automatically.

## Architecture notes

- **Multi-tenancy:** shared database/schema. Every tenant model inherits `TenantModel`
  (`apps/core/models.py`) with an `organization` FK. `TenantViewSet` scopes every query to the
  caller's active organization (selectable via the `X-Organization` header when a user belongs to
  several) and stamps `organization`/`created_by` on create. Related-field writes are scoped with
  `TenantPrimaryKeyRelatedField` / `OrgMemberPrimaryKeyRelatedField`, so cross-tenant references are
  rejected at the serializer layer.
- **Roles:** `owner`/`admin` unlock organization, team, and billing management (`IsOrgAdmin`).
- **Billing:** plan and subscription models with a simulated checkout — swap
  `apps/organizations/views.py::SubscriptionView.post` for a real payment provider.
- **i18n/RTL:** the frontend uses i18next namespaces per feature (`src/i18n/locales/{en,ar}/`);
  the document `dir` flips automatically and all layout uses logical (`ms-`/`me-`/`start-`/`end-`)
  utilities. The interface uses Manrope for Latin and IBM Plex Sans Arabic for Arabic.
- **API:** everything under `/api/v1/`. Auth: `POST /auth/register/`, `POST /auth/token/`,
  `POST /auth/token/refresh/`, `GET/PATCH /auth/me/`. Domain routers: `contacts`, `companies`,
  `tags`, `leads` (+`/convert/`), `pipelines`, `stages`, `deals` (+`/move/`, `/mark-won/`,
  `/mark-lost/`, `/reopen/`), `activities` (+`/complete/`), `notes`, `employees`, `departments`,
  `tickets` (+`/comments/`), `memberships`, `invitations`, `plans`, `subscription`,
  `analytics/dashboard/`.

## Tests

```bash
cd backend && .venv/bin/python manage.py test apps
cd frontend && npm run typecheck
```

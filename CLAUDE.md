# Korzah CRM — project guide

Multi-tenant SaaS CRM. Backend: Django 5.2 + DRF (`backend/`, venv at `backend/.venv`, Python 3.13 via uv). Frontend: React 18 + TS + Vite + Tailwind (`frontend/`).

## Commands
- Backend checks/tests: `cd backend && .venv/bin/python manage.py check` / `manage.py test apps`
- Backend run: `.venv/bin/python manage.py runserver` (SQLite by default; Postgres via `POSTGRES_*` env)
- Frontend: `cd frontend && npm run dev` / `npm run typecheck` / `npm run build`
- Demo data: `manage.py seed_demo` → demo@crm.com / demo1234

## House rules (follow the existing exemplars)
- **Backend exemplar:** `backend/apps/contacts/` (serializers/views/urls/tests). Tenant models inherit `apps.core.models.TenantModel`; viewsets extend `apps.core.viewsets.TenantViewSet` (never filter by org manually); FK writes use `TenantPrimaryKeyRelatedField` / `OrgMemberPrimaryKeyRelatedField`; nested read-only objects are named `<fk>_detail`.
- **Frontend exemplar:** `frontend/src/features/contacts/`. API calls only through `src/api/*` modules; types in `src/types/index.ts` mirror the API exactly; UI only from `src/components/ui` + lucide-react.
- **RTL:** Arabic is first-class. Only logical Tailwind utilities (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`/`text-start`); wrap emails/phones/URLs in `dir="ltr"`.
- **Dark mode:** every color utility needs a `dark:` variant (class strategy).
- **i18n:** per-feature namespaces in `src/i18n/locales/{en,ar}/<ns>.json`; both languages always updated together; shared strings live in `common.json`; zero hardcoded UI strings.

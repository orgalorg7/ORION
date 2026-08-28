// ---------------------------------------------------------------------------
// Demo mode: an in-browser implementation of the REST API. Mirrors the Django
// backend's routes, serializers (incl. *_detail nesting), filters, pagination
// (max page_size 100) and validation rules, backed by the localStorage store.
// ---------------------------------------------------------------------------

import {
  createDefaultPipeline,
  ensurePlans,
  getDb,
  nextId,
  persist,
  slugify,
  type DActivity,
  type DB,
  type DCompany,
  type DContact,
  type DDeal,
  type DEmployee,
  type DLead,
  type DMembership,
  type DNote,
  type DTicket,
  type DUser,
} from './store';

export interface DemoRequest {
  method: string;
  path: string;
  params: Record<string, unknown>;
  data: unknown;
  headers: Record<string, string>;
}

export interface DemoResponse {
  status: number;
  data: unknown;
}

class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super('api error');
  }
}

const err = (status: number, body: unknown): never => {
  throw new ApiError(status, body);
};
const notFound = (): never => err(404, { detail: 'Not found.' });
const now = () => new Date().toISOString();

interface Ctx {
  db: DB;
  user: DUser;
  membership: DMembership;
  orgId: number;
  body: Record<string, unknown>;
  params: Record<string, unknown>;
}

// --- Small helpers -----------------------------------------------------------

function decStr(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseFloat(String(value));
  return Number.isNaN(parsed) ? null : parsed.toFixed(2);
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function paginate<T>(items: T[], params: Record<string, unknown>) {
  const pageSize = Math.min(Math.max(parseInt(String(params.page_size ?? 20), 10) || 20, 1), 100);
  const page = Math.max(parseInt(String(params.page ?? 1), 10) || 1, 1);
  const start = (page - 1) * pageSize;
  if (items.length > 0 && start >= items.length) err(404, { detail: 'Invalid page.' });
  return {
    count: items.length,
    next: start + pageSize < items.length ? `?page=${page + 1}` : null,
    previous: page > 1 ? `?page=${page - 1}` : null,
    results: items.slice(start, start + pageSize),
  };
}

function search<T>(items: T[], term: unknown, fields: (item: T) => (string | null | undefined)[]): T[] {
  const query = String(term ?? '').trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) =>
    fields(item).some((field) => (field ?? '').toLowerCase().includes(query)),
  );
}

type OrderGetter<T> = (item: T) => string | number | null;

function order<T>(items: T[], ordering: unknown, getters: Record<string, OrderGetter<T>>, fallback: string): T[] {
  const spec = String(ordering ?? '').trim() || fallback;
  const keys = spec.split(',').map((k) => k.trim()).filter(Boolean);
  const sorted = [...items];
  sorted.sort((a, b) => {
    for (const key of keys) {
      const desc = key.startsWith('-');
      const getter = getters[desc ? key.slice(1) : key];
      if (!getter) continue;
      const va = getter(a);
      const vb = getter(b);
      if (va === vb) continue;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      if (cmp !== 0) return desc ? -cmp : cmp;
    }
    return 0;
  });
  return sorted;
}

/** Apply exact-match filters: {queryParam: recordField or predicate}. */
function applyFilters<T>(
  items: T[],
  params: Record<string, unknown>,
  filters: Record<string, (item: T, value: string) => boolean>,
): T[] {
  let result = items;
  for (const [param, predicate] of Object.entries(filters)) {
    const raw = params[param];
    if (raw === undefined || raw === null || raw === '') continue;
    result = result.filter((item) => predicate(item, String(raw)));
  }
  return result;
}

const eqId = (field: string) => (item: Record<string, unknown>, value: string) =>
  String(item[field] ?? '') === value;
const eqStr = eqId;
const eqBool = (field: string) => (item: Record<string, unknown>, value: string) =>
  Boolean(item[field]) === asBool(value);
const hasTag = (item: { tags: number[] }, value: string) => item.tags.includes(Number(value));

// --- Serializers -------------------------------------------------------------

function userBrief(db: DB, id: number | null) {
  const user = db.users.find((u) => u.id === id);
  return user
    ? { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name }
    : null;
}

function tagS(db: DB, id: number) {
  const tag = db.tags.find((t) => t.id === id);
  return tag ? { id: tag.id, name: tag.name, color: tag.color, created_at: tag.created_at } : null;
}

const tagsDetail = (db: DB, ids: number[]) => ids.map((id) => tagS(db, id)).filter(Boolean);

function contactBrief(db: DB, id: number | null) {
  const contact = db.contacts.find((c) => c.id === id);
  return contact ? { id: contact.id, first_name: contact.first_name, last_name: contact.last_name } : null;
}

function companyBrief(db: DB, id: number | null) {
  const company = db.companies.find((c) => c.id === id);
  return company ? { id: company.id, name: company.name } : null;
}

function orgS(db: DB, id: number) {
  const org = db.organizations.find((o) => o.id === id)!;
  return {
    id: org.id, name: org.name, slug: org.slug, industry: org.industry, size: org.size,
    country: org.country, website: org.website, currency: org.currency,
    default_language: org.default_language, created_at: org.created_at,
  };
}

function planS(db: DB, id: number) {
  const plan = db.plans.find((p) => p.id === id)!;
  return { ...plan };
}

function userS(user: DUser) {
  return {
    id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name,
    phone: user.phone, language: user.language, date_joined: user.date_joined,
  };
}

function companyS(db: DB, company: DCompany) {
  return {
    ...company,
    annual_revenue: company.annual_revenue,
    owner_detail: userBrief(db, company.owner),
    tags_detail: tagsDetail(db, company.tags),
    contacts_count: db.contacts.filter((c) => c.company === company.id).length,
  };
}

function contactS(db: DB, contact: DContact) {
  return {
    ...contact,
    company_detail: companyBrief(db, contact.company),
    owner_detail: userBrief(db, contact.owner),
    tags_detail: tagsDetail(db, contact.tags),
  };
}

function leadS(db: DB, lead: DLead) {
  return { ...lead, owner_detail: userBrief(db, lead.owner) };
}

function stageS(db: DB, id: number | null) {
  const stage = db.stages.find((s) => s.id === id);
  return stage
    ? {
        id: stage.id, pipeline: stage.pipeline, name: stage.name, order: stage.order,
        probability: stage.probability, color: stage.color,
      }
    : null;
}

function pipelineS(db: DB, id: number) {
  const pipeline = db.pipelines.find((p) => p.id === id)!;
  const stages = db.stages
    .filter((s) => s.pipeline === pipeline.id)
    .sort((a, b) => a.order - b.order || a.id - b.id)
    .map((s) => stageS(db, s.id));
  return { id: pipeline.id, name: pipeline.name, is_default: pipeline.is_default, stages };
}

function dealS(db: DB, deal: DDeal) {
  return {
    ...deal,
    stage_detail: stageS(db, deal.stage),
    contact_detail: contactBrief(db, deal.contact),
    company_detail: companyBrief(db, deal.company),
    owner_detail: userBrief(db, deal.owner),
    tags_detail: tagsDetail(db, deal.tags),
  };
}

function activityS(db: DB, activity: DActivity) {
  const deal = db.deals.find((d) => d.id === activity.deal);
  const lead = db.leads.find((l) => l.id === activity.lead);
  return {
    ...activity,
    assigned_to_detail: userBrief(db, activity.assigned_to),
    contact_detail: contactBrief(db, activity.contact),
    company_detail: companyBrief(db, activity.company),
    deal_detail: deal ? { id: deal.id, title: deal.title } : null,
    lead_detail: lead ? { id: lead.id, first_name: lead.first_name, last_name: lead.last_name } : null,
  };
}

function noteS(db: DB, note: DNote) {
  return { ...note, author_detail: userBrief(db, note.author) };
}

function employeeS(db: DB, employee: DEmployee) {
  const department = db.departments.find((d) => d.id === employee.department);
  const manager = db.employees.find((e) => e.id === employee.manager);
  return {
    ...employee,
    user_detail: userBrief(db, employee.user),
    department_detail: department ? { id: department.id, name: department.name } : null,
    manager_detail: manager
      ? { id: manager.id, first_name: manager.first_name, last_name: manager.last_name }
      : null,
  };
}

function ticketS(db: DB, ticket: DTicket) {
  return {
    ...ticket,
    contact_detail: contactBrief(db, ticket.contact),
    assigned_to_detail: userBrief(db, ticket.assigned_to),
    comments_count: db.ticketComments.filter((c) => c.ticket === ticket.id).length,
  };
}

// --- FK validation ------------------------------------------------------------

function orgFk<T extends { id: number; organization: number }>(
  ctx: Ctx, collection: T[], value: unknown, field: string,
): number | null {
  if (value === null || value === undefined || value === '') return null;
  const id = Number(value);
  const record = collection.find((item) => item.id === id && item.organization === ctx.orgId);
  if (!record) err(400, { [field]: [`Invalid pk "${value}" - object does not exist.`] });
  return id;
}

function memberFk(ctx: Ctx, value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  const id = Number(value);
  const ok = ctx.db.memberships.some((m) => m.user === id && m.organization === ctx.orgId && m.is_active);
  if (!ok) err(400, { [field]: [`Invalid pk "${value}" - object does not exist.`] });
  return id;
}

function orgTags(ctx: Ctx, value: unknown): number[] | undefined {
  if (value === undefined) return undefined;
  const ids = Array.isArray(value) ? value.map(Number) : [];
  for (const id of ids) {
    if (!ctx.db.tags.some((t) => t.id === id && t.organization === ctx.orgId)) {
      err(400, { tags: [`Invalid pk "${id}" - object does not exist.`] });
    }
  }
  return ids;
}

const isAdmin = (ctx: Ctx) => ctx.membership.role === 'owner' || ctx.membership.role === 'admin';
const requireAdmin = (ctx: Ctx) => {
  if (!isAdmin(ctx)) err(403, { detail: 'This action requires an owner or admin role.' });
};

// --- Cascades on delete --------------------------------------------------------

function deleteContact(db: DB, id: number) {
  db.activities = db.activities.filter((a) => a.contact !== id);
  db.notes = db.notes.filter((n) => n.contact !== id);
  for (const deal of db.deals) if (deal.contact === id) deal.contact = null;
  for (const ticket of db.tickets) if (ticket.contact === id) ticket.contact = null;
  for (const lead of db.leads) if (lead.converted_contact === id) lead.converted_contact = null;
  db.contacts = db.contacts.filter((c) => c.id !== id);
}

function deleteCompany(db: DB, id: number) {
  db.activities = db.activities.filter((a) => a.company !== id);
  db.notes = db.notes.filter((n) => n.company !== id);
  for (const contact of db.contacts) if (contact.company === id) contact.company = null;
  for (const deal of db.deals) if (deal.company === id) deal.company = null;
  db.companies = db.companies.filter((c) => c.id !== id);
}

function deleteDeal(db: DB, id: number) {
  db.activities = db.activities.filter((a) => a.deal !== id);
  db.notes = db.notes.filter((n) => n.deal !== id);
  for (const lead of db.leads) if (lead.converted_deal === id) lead.converted_deal = null;
  db.deals = db.deals.filter((d) => d.id !== id);
}

function deleteLead(db: DB, id: number) {
  db.activities = db.activities.filter((a) => a.lead !== id);
  db.notes = db.notes.filter((n) => n.lead !== id);
  db.leads = db.leads.filter((l) => l.id !== id);
}

// --- Route table ----------------------------------------------------------------

type Handler = (ctx: Ctx, match: RegExpMatchArray) => DemoResponse | { status?: number; data?: unknown };

interface Route {
  method: string;
  pattern: RegExp;
  auth: boolean;
  handler: Handler;
}

const routes: Route[] = [];
const route = (method: string, pattern: RegExp, handler: Handler, auth = true) =>
  routes.push({ method, pattern, handler, auth });

const ok = (data: unknown, status = 200) => ({ status, data });

// --- Auth ---------------------------------------------------------------------

route('POST', /^\/auth\/token\/$/, (ctx) => {
  const email = String(ctx.body.email ?? '').toLowerCase();
  const password = String(ctx.body.password ?? '');
  const user = ctx.db.users.find((u) => u.email.toLowerCase() === email && u.password === password);
  if (!user) return err(401, { detail: 'No active account found with the given credentials' });
  return ok({ access: `demo-access-${user.id}`, refresh: `demo-refresh-${user.id}` });
}, false);

route('POST', /^\/auth\/token\/refresh\/$/, (ctx) => {
  const refresh = String(ctx.body.refresh ?? '');
  const match = refresh.match(/^demo-refresh-(\d+)$/);
  if (!match) return err(401, { detail: 'Token is invalid or expired' });
  return ok({ access: `demo-access-${match[1]}` });
}, false);

route('POST', /^\/auth\/register\/$/, (ctx) => {
  const db = ctx.db;
  const email = String(ctx.body.email ?? '').toLowerCase().trim();
  const password = String(ctx.body.password ?? '');
  const firstName = String(ctx.body.first_name ?? '').trim();
  const orgName = String(ctx.body.organization_name ?? '').trim();
  if (!email) err(400, { email: ['This field is required.'] });
  if (db.users.some((u) => u.email.toLowerCase() === email)) {
    err(400, { email: ['A user with this email already exists.'] });
  }
  if (password.length < 8) err(400, { password: ['This password is too short. It must contain at least 8 characters.'] });
  if (!firstName) err(400, { first_name: ['This field is required.'] });
  if (!orgName) err(400, { organization_name: ['This field is required.'] });

  const language = ctx.body.language === 'ar' ? 'ar' : 'en';
  const user: DUser = {
    id: nextId(db), email, password, first_name: firstName,
    last_name: String(ctx.body.last_name ?? ''), phone: '', language, date_joined: now(),
  };
  db.users.push(user);
  let slug = slugify(orgName);
  let counter = 2;
  while (db.organizations.some((o) => o.slug === slug)) slug = `${slugify(orgName)}-${counter++}`;
  const org = {
    id: nextId(db), name: orgName, slug, industry: '', size: '', country: '', website: '',
    currency: 'USD', default_language: language, created_at: now(),
  };
  db.organizations.push(org);
  db.memberships.push({
    id: nextId(db), user: user.id, organization: org.id, role: 'owner', is_active: true, created_at: now(),
  });
  ensurePlans(db);
  db.subscriptions.push({
    id: nextId(db), organization: org.id, plan: db.plans.find((p) => p.is_default)!.id,
    status: 'trialing', trial_end: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    current_period_end: new Date(Date.now() + 14 * 86_400_000).toISOString(), cancel_at_period_end: false,
  });
  createDefaultPipeline(db, org.id);
  for (const invitation of db.invitations) {
    if (invitation.email.toLowerCase() === email && !invitation.accepted_at) {
      if (!db.memberships.some((m) => m.user === user.id && m.organization === invitation.organization)) {
        db.memberships.push({
          id: nextId(db), user: user.id, organization: invitation.organization,
          role: invitation.role === 'owner' ? 'member' : invitation.role, is_active: true, created_at: now(),
        });
      }
      invitation.accepted_at = now();
    }
  }
  return ok(
    {
      user: userS(user),
      organization: { id: org.id, name: org.name, slug: org.slug },
      access: `demo-access-${user.id}`,
      refresh: `demo-refresh-${user.id}`,
    },
    201,
  );
}, false);

route('GET', /^\/auth\/me\/$/, (ctx) => {
  const memberships = ctx.db.memberships
    .filter((m) => m.user === ctx.user.id && m.is_active)
    .map((m) => ({ id: m.id, role: m.role, is_active: m.is_active, organization: orgS(ctx.db, m.organization) }));
  return ok({ user: userS(ctx.user), memberships });
});

route('PATCH', /^\/auth\/me\/$/, (ctx) => {
  const user = ctx.user;
  if (ctx.body.first_name !== undefined) user.first_name = String(ctx.body.first_name);
  if (ctx.body.last_name !== undefined) user.last_name = String(ctx.body.last_name);
  if (ctx.body.phone !== undefined) user.phone = String(ctx.body.phone);
  if (ctx.body.language === 'en' || ctx.body.language === 'ar') user.language = ctx.body.language;
  return ok(userS(user));
});

route('POST', /^\/auth\/change-password\/$/, (ctx) => {
  if (String(ctx.body.current_password ?? '') !== ctx.user.password) {
    err(400, { current_password: ['Current password is incorrect.'] });
  }
  const next = String(ctx.body.new_password ?? '');
  if (next.length < 8) err(400, { new_password: ['This password is too short. It must contain at least 8 characters.'] });
  ctx.user.password = next;
  return ok({ detail: 'Password updated.' });
});

// --- Organization / team / billing ---------------------------------------------

route('GET', /^\/organization\/$/, (ctx) => ok(orgS(ctx.db, ctx.orgId)));

route('PATCH', /^\/organization\/$/, (ctx) => {
  requireAdmin(ctx);
  const org = ctx.db.organizations.find((o) => o.id === ctx.orgId)!;
  for (const field of ['name', 'industry', 'size', 'country', 'website', 'currency', 'default_language'] as const) {
    if (ctx.body[field] !== undefined) org[field] = String(ctx.body[field]);
  }
  return ok(orgS(ctx.db, ctx.orgId));
});

route('GET', /^\/memberships\/$/, (ctx) => {
  let items = ctx.db.memberships.filter((m) => m.organization === ctx.orgId);
  items = applyFilters(items, ctx.params, {
    role: eqStr('role') as never,
    is_active: eqBool('is_active') as never,
  });
  items = search(items, ctx.params.search, (m) => {
    const user = ctx.db.users.find((u) => u.id === m.user);
    return [user?.email, user?.first_name, user?.last_name];
  });
  items = [...items].sort((a, b) => a.id - b.id);
  const page = paginate(items, ctx.params);
  return ok({
    ...page,
    results: page.results.map((m) => ({
      id: m.id, role: m.role, is_active: m.is_active, user: userBrief(ctx.db, m.user), created_at: m.created_at,
    })),
  });
});

route('PATCH', /^\/memberships\/(\d+)\/$/, (ctx, match) => {
  requireAdmin(ctx);
  const target = ctx.db.memberships.find((m) => m.id === Number(match[1]) && m.organization === ctx.orgId);
  if (!target) return notFound();
  if (target.role === 'owner') err(400, { detail: 'The owner membership cannot be modified.' });
  if (target.id === ctx.membership.id) err(400, { detail: 'You cannot modify your own membership.' });
  const role = ctx.body.role;
  if (role !== undefined) {
    if (role !== 'admin' && role !== 'manager' && role !== 'member') err(400, { detail: 'Invalid role.' });
    target.role = role as DMembership['role'];
  }
  if ('is_active' in ctx.body) target.is_active = Boolean(ctx.body.is_active);
  return ok({
    id: target.id, role: target.role, is_active: target.is_active,
    user: userBrief(ctx.db, target.user), created_at: target.created_at,
  });
});

const invitationS = (ctx: Ctx, invitation: (typeof ctx.db.invitations)[number]) => ({
  id: invitation.id, email: invitation.email, role: invitation.role,
  invited_by: userBrief(ctx.db, invitation.invited_by),
  accepted_at: invitation.accepted_at, created_at: invitation.created_at,
});

route('GET', /^\/invitations\/$/, (ctx) => {
  requireAdmin(ctx);
  const items = ctx.db.invitations.filter((i) => i.organization === ctx.orgId && !i.accepted_at);
  const page = paginate(items, ctx.params);
  return ok({ ...page, results: page.results.map((i) => invitationS(ctx, i)) });
});

route('POST', /^\/invitations\/$/, (ctx) => {
  requireAdmin(ctx);
  const email = String(ctx.body.email ?? '').toLowerCase().trim();
  const role = String(ctx.body.role ?? 'member');
  if (!email || !email.includes('@')) err(400, { email: ['Enter a valid email address.'] });
  if (role === 'owner') err(400, { detail: 'Cannot invite as owner.' });
  const existing = ctx.db.users.find((u) => u.email.toLowerCase() === email);
  if (existing) {
    if (ctx.db.memberships.some((m) => m.user === existing.id && m.organization === ctx.orgId)) {
      err(400, { detail: 'This user is already a member of the organization.' });
    }
    ctx.db.memberships.push({
      id: nextId(ctx.db), user: existing.id, organization: ctx.orgId,
      role: role as DMembership['role'], is_active: true, created_at: now(),
    });
    return ok({ detail: 'User added to the organization.', added: true }, 201);
  }
  if (ctx.db.invitations.some((i) => i.organization === ctx.orgId && i.email === email && !i.accepted_at)) {
    err(400, { detail: 'An invitation for this email is already pending.' });
  }
  const invitation = {
    id: nextId(ctx.db), organization: ctx.orgId, email, role: role as DMembership['role'],
    invited_by: ctx.user.id, accepted_at: null, created_at: now(),
  };
  ctx.db.invitations.push(invitation);
  return ok(invitationS(ctx, invitation), 201);
});

route('DELETE', /^\/invitations\/(\d+)\/$/, (ctx, match) => {
  requireAdmin(ctx);
  const before = ctx.db.invitations.length;
  ctx.db.invitations = ctx.db.invitations.filter(
    (i) => !(i.id === Number(match[1]) && i.organization === ctx.orgId),
  );
  if (ctx.db.invitations.length === before) return notFound();
  return { status: 204, data: null };
});

route('GET', /^\/plans\/$/, (ctx) => {
  ensurePlans(ctx.db);
  return ok([...ctx.db.plans].sort((a, b) => a.sort_order - b.sort_order));
});

const subscriptionS = (ctx: Ctx) => {
  const sub = ctx.db.subscriptions.find((s) => s.organization === ctx.orgId);
  if (!sub) return notFound();
  return {
    id: sub.id, plan: planS(ctx.db, sub.plan), status: sub.status,
    trial_end: sub.trial_end, current_period_end: sub.current_period_end,
    cancel_at_period_end: sub.cancel_at_period_end,
  };
};

route('GET', /^\/subscription\/$/, (ctx) => ok(subscriptionS(ctx)));

route('POST', /^\/subscription\/$/, (ctx) => {
  requireAdmin(ctx);
  const plan = ctx.db.plans.find((p) => p.id === Number(ctx.body.plan_id));
  if (!plan) err(400, { plan_id: ['Invalid plan.'] });
  const sub = ctx.db.subscriptions.find((s) => s.organization === ctx.orgId)!;
  sub.plan = plan!.id;
  sub.status = 'active';
  sub.trial_end = null;
  sub.current_period_end = new Date(Date.now() + 30 * 86_400_000).toISOString();
  sub.cancel_at_period_end = false;
  return ok(subscriptionS(ctx));
});

// --- Tags -----------------------------------------------------------------------

route('GET', /^\/tags\/$/, (ctx) => {
  let items = ctx.db.tags.filter((t) => t.organization === ctx.orgId);
  items = search(items, ctx.params.search, (t) => [t.name]);
  return ok([...items].sort((a, b) => a.name.localeCompare(b.name)).map((t) => tagS(ctx.db, t.id)));
});

route('POST', /^\/tags\/$/, (ctx) => {
  const name = String(ctx.body.name ?? '').trim();
  if (!name) err(400, { name: ['This field is required.'] });
  const tag = {
    id: nextId(ctx.db), organization: ctx.orgId, name,
    color: String(ctx.body.color ?? '#d5a928'), created_at: now(), updated_at: now(),
  };
  ctx.db.tags.push(tag);
  return ok(tagS(ctx.db, tag.id), 201);
});

route('PATCH', /^\/tags\/(\d+)\/$/, (ctx, match) => {
  const tag = ctx.db.tags.find((t) => t.id === Number(match[1]) && t.organization === ctx.orgId);
  if (!tag) return notFound();
  if (ctx.body.name !== undefined) tag.name = String(ctx.body.name);
  if (ctx.body.color !== undefined) tag.color = String(ctx.body.color);
  tag.updated_at = now();
  return ok(tagS(ctx.db, tag.id));
});

route('DELETE', /^\/tags\/(\d+)\/$/, (ctx, match) => {
  const id = Number(match[1]);
  if (!ctx.db.tags.some((t) => t.id === id && t.organization === ctx.orgId)) return notFound();
  ctx.db.tags = ctx.db.tags.filter((t) => t.id !== id);
  for (const list of [ctx.db.contacts, ctx.db.companies, ctx.db.deals]) {
    for (const record of list) record.tags = record.tags.filter((t) => t !== id);
  }
  return { status: 204, data: null };
});

// --- Companies -------------------------------------------------------------------

function companyPayload(ctx: Ctx, body: Record<string, unknown>, target: Partial<DCompany>) {
  for (const field of [
    'name', 'domain', 'industry', 'size', 'website', 'email', 'phone',
    'address', 'city', 'country', 'description',
  ] as const) {
    if (body[field] !== undefined) target[field] = String(body[field] ?? '');
  }
  if (body.annual_revenue !== undefined) target.annual_revenue = decStr(body.annual_revenue);
  if (body.owner !== undefined) target.owner = memberFk(ctx, body.owner, 'owner');
  const tags = orgTags(ctx, body.tags);
  if (tags !== undefined) target.tags = tags;
}

route('GET', /^\/companies\/$/, (ctx) => {
  let items = ctx.db.companies.filter((c) => c.organization === ctx.orgId);
  items = applyFilters(items, ctx.params, {
    industry: eqStr('industry') as never,
    size: eqStr('size') as never,
    owner: eqId('owner') as never,
    country: eqStr('country') as never,
    tags: hasTag as never,
  });
  items = search(items, ctx.params.search, (c) => [c.name, c.domain, c.industry, c.city, c.email]);
  items = order(items, ctx.params.ordering, {
    name: (c) => c.name,
    created_at: (c) => c.created_at,
    annual_revenue: (c) => (c.annual_revenue === null ? null : parseFloat(c.annual_revenue)),
  }, '-created_at');
  const page = paginate(items, ctx.params);
  return ok({ ...page, results: page.results.map((c) => companyS(ctx.db, c)) });
});

route('POST', /^\/companies\/$/, (ctx) => {
  if (!String(ctx.body.name ?? '').trim()) err(400, { name: ['This field is required.'] });
  const company: DCompany = {
    id: nextId(ctx.db), organization: ctx.orgId, name: '', domain: '', industry: '', size: '',
    website: '', email: '', phone: '', address: '', city: '', country: '', annual_revenue: null,
    description: '', owner: null, tags: [], created_at: now(), updated_at: now(),
  };
  companyPayload(ctx, ctx.body, company);
  ctx.db.companies.push(company);
  return ok(companyS(ctx.db, company), 201);
});

route('GET', /^\/companies\/(\d+)\/$/, (ctx, match) => {
  const company = ctx.db.companies.find((c) => c.id === Number(match[1]) && c.organization === ctx.orgId);
  return company ? ok(companyS(ctx.db, company)) : notFound();
});

route('PATCH', /^\/companies\/(\d+)\/$/, (ctx, match) => {
  const company = ctx.db.companies.find((c) => c.id === Number(match[1]) && c.organization === ctx.orgId);
  if (!company) return notFound();
  companyPayload(ctx, ctx.body, company);
  company.updated_at = now();
  return ok(companyS(ctx.db, company));
});

route('DELETE', /^\/companies\/(\d+)\/$/, (ctx, match) => {
  const company = ctx.db.companies.find((c) => c.id === Number(match[1]) && c.organization === ctx.orgId);
  if (!company) return notFound();
  deleteCompany(ctx.db, company.id);
  return { status: 204, data: null };
});

// --- Contacts ---------------------------------------------------------------------

function contactPayload(ctx: Ctx, body: Record<string, unknown>, target: Partial<DContact>) {
  for (const field of [
    'first_name', 'last_name', 'email', 'phone', 'job_title', 'source',
    'address', 'city', 'country', 'description',
  ] as const) {
    if (body[field] !== undefined) target[field] = String(body[field] ?? '');
  }
  if (body.company !== undefined) target.company = orgFk(ctx, ctx.db.companies, body.company, 'company');
  if (body.owner !== undefined) target.owner = memberFk(ctx, body.owner, 'owner');
  if (body.is_active !== undefined) target.is_active = Boolean(body.is_active);
  const tags = orgTags(ctx, body.tags);
  if (tags !== undefined) target.tags = tags;
}

route('GET', /^\/contacts\/$/, (ctx) => {
  let items = ctx.db.contacts.filter((c) => c.organization === ctx.orgId);
  items = applyFilters(items, ctx.params, {
    company: eqId('company') as never,
    owner: eqId('owner') as never,
    source: eqStr('source') as never,
    is_active: eqBool('is_active') as never,
    tags: hasTag as never,
  });
  items = search(items, ctx.params.search, (c) => [
    c.first_name, c.last_name, c.email, c.phone, c.job_title,
    companyBrief(ctx.db, c.company)?.name,
  ]);
  items = order(items, ctx.params.ordering, {
    first_name: (c) => c.first_name,
    last_name: (c) => c.last_name,
    created_at: (c) => c.created_at,
  }, '-created_at');
  const page = paginate(items, ctx.params);
  return ok({ ...page, results: page.results.map((c) => contactS(ctx.db, c)) });
});

route('POST', /^\/contacts\/$/, (ctx) => {
  if (!String(ctx.body.first_name ?? '').trim()) err(400, { first_name: ['This field is required.'] });
  const contact: DContact = {
    id: nextId(ctx.db), organization: ctx.orgId, first_name: '', last_name: '', email: '', phone: '',
    job_title: '', company: null, owner: null, source: '', address: '', city: '', country: '',
    description: '', is_active: true, tags: [], created_at: now(), updated_at: now(),
  };
  contactPayload(ctx, ctx.body, contact);
  ctx.db.contacts.push(contact);
  return ok(contactS(ctx.db, contact), 201);
});

route('GET', /^\/contacts\/(\d+)\/$/, (ctx, match) => {
  const contact = ctx.db.contacts.find((c) => c.id === Number(match[1]) && c.organization === ctx.orgId);
  return contact ? ok(contactS(ctx.db, contact)) : notFound();
});

route('PATCH', /^\/contacts\/(\d+)\/$/, (ctx, match) => {
  const contact = ctx.db.contacts.find((c) => c.id === Number(match[1]) && c.organization === ctx.orgId);
  if (!contact) return notFound();
  contactPayload(ctx, ctx.body, contact);
  contact.updated_at = now();
  return ok(contactS(ctx.db, contact));
});

route('DELETE', /^\/contacts\/(\d+)\/$/, (ctx, match) => {
  const contact = ctx.db.contacts.find((c) => c.id === Number(match[1]) && c.organization === ctx.orgId);
  if (!contact) return notFound();
  deleteContact(ctx.db, contact.id);
  return { status: 204, data: null };
});

// --- Leads ------------------------------------------------------------------------

function leadPayload(ctx: Ctx, body: Record<string, unknown>, target: DLead, isCreate: boolean) {
  for (const field of [
    'first_name', 'last_name', 'email', 'phone', 'company_name', 'job_title', 'source', 'description',
  ] as const) {
    if (body[field] !== undefined) target[field] = String(body[field] ?? '');
  }
  if (body.status !== undefined) {
    const value = String(body.status);
    const alreadyConverted = !isCreate && target.status === 'converted';
    if (value === 'converted' && !alreadyConverted) {
      err(400, { status: ['Use the convert action to mark a lead as converted.'] });
    }
    if (!['new', 'contacted', 'qualified', 'unqualified', 'converted'].includes(value)) {
      err(400, { status: [`"${value}" is not a valid choice.`] });
    }
    target.status = value;
  }
  if (body.score !== undefined) {
    const score = Number(body.score);
    if (Number.isNaN(score) || score < 0 || score > 100) err(400, { score: ['Score must be between 0 and 100.'] });
    target.score = Math.round(score);
  }
  if (body.estimated_value !== undefined) target.estimated_value = decStr(body.estimated_value);
  if (body.owner !== undefined) target.owner = memberFk(ctx, body.owner, 'owner');
}

route('GET', /^\/leads\/$/, (ctx) => {
  let items = ctx.db.leads.filter((l) => l.organization === ctx.orgId);
  items = applyFilters(items, ctx.params, {
    status: eqStr('status') as never,
    source: eqStr('source') as never,
    owner: eqId('owner') as never,
  });
  items = search(items, ctx.params.search, (l) => [l.first_name, l.last_name, l.email, l.phone, l.company_name]);
  items = order(items, ctx.params.ordering, {
    created_at: (l) => l.created_at,
    score: (l) => l.score,
    estimated_value: (l) => (l.estimated_value === null ? null : parseFloat(l.estimated_value)),
  }, '-created_at');
  const page = paginate(items, ctx.params);
  return ok({ ...page, results: page.results.map((l) => leadS(ctx.db, l)) });
});

route('POST', /^\/leads\/$/, (ctx) => {
  if (!String(ctx.body.first_name ?? '').trim()) err(400, { first_name: ['This field is required.'] });
  const lead: DLead = {
    id: nextId(ctx.db), organization: ctx.orgId, first_name: '', last_name: '', email: '', phone: '',
    company_name: '', job_title: '', source: '', status: 'new', score: 0, estimated_value: null,
    owner: null, description: '', converted_at: null, converted_contact: null, converted_deal: null,
    created_at: now(), updated_at: now(),
  };
  leadPayload(ctx, ctx.body, lead, true);
  ctx.db.leads.push(lead);
  return ok(leadS(ctx.db, lead), 201);
});

route('GET', /^\/leads\/(\d+)\/$/, (ctx, match) => {
  const lead = ctx.db.leads.find((l) => l.id === Number(match[1]) && l.organization === ctx.orgId);
  return lead ? ok(leadS(ctx.db, lead)) : notFound();
});

route('PATCH', /^\/leads\/(\d+)\/$/, (ctx, match) => {
  const lead = ctx.db.leads.find((l) => l.id === Number(match[1]) && l.organization === ctx.orgId);
  if (!lead) return notFound();
  leadPayload(ctx, ctx.body, lead, false);
  lead.updated_at = now();
  return ok(leadS(ctx.db, lead));
});

route('DELETE', /^\/leads\/(\d+)\/$/, (ctx, match) => {
  const lead = ctx.db.leads.find((l) => l.id === Number(match[1]) && l.organization === ctx.orgId);
  if (!lead) return notFound();
  deleteLead(ctx.db, lead.id);
  return { status: 204, data: null };
});

route('POST', /^\/leads\/(\d+)\/convert\/$/, (ctx, match) => {
  const db = ctx.db;
  const lead = db.leads.find((l) => l.id === Number(match[1]) && l.organization === ctx.orgId);
  if (!lead) return notFound();
  if (lead.status === 'converted') err(400, { detail: 'This lead has already been converted.' });

  let companyId: number | null = null;
  if (lead.company_name.trim()) {
    const existing = db.companies.find((c) => c.organization === ctx.orgId && c.name === lead.company_name);
    if (existing) companyId = existing.id;
    else {
      const company: DCompany = {
        id: nextId(db), organization: ctx.orgId, name: lead.company_name, domain: '', industry: '',
        size: '', website: '', email: '', phone: '', address: '', city: '', country: '',
        annual_revenue: null, description: '', owner: lead.owner, tags: [],
        created_at: now(), updated_at: now(),
      };
      db.companies.push(company);
      companyId = company.id;
    }
  }
  const contact: DContact = {
    id: nextId(db), organization: ctx.orgId, first_name: lead.first_name, last_name: lead.last_name,
    email: lead.email, phone: lead.phone, job_title: lead.job_title, company: companyId,
    owner: lead.owner, source: lead.source, address: '', city: '', country: '',
    description: lead.description, is_active: true, tags: [], created_at: now(), updated_at: now(),
  };
  db.contacts.push(contact);

  let dealId: number | null = null;
  if (asBool(ctx.body.create_deal)) {
    const pipelineId = ctx.body.pipeline
      ? orgFk(ctx, db.pipelines, ctx.body.pipeline, 'pipeline')
      : (db.pipelines.find((p) => p.organization === ctx.orgId && p.is_default)?.id ??
        db.pipelines.find((p) => p.organization === ctx.orgId)?.id ?? null);
    if (pipelineId === null) err(400, { detail: 'No pipeline available to create a deal.' });
    const pipelineStages = db.stages
      .filter((s) => s.pipeline === pipelineId)
      .sort((a, b) => a.order - b.order || a.id - b.id);
    const stageId = ctx.body.stage ? orgFk(ctx, db.stages, ctx.body.stage, 'stage') : (pipelineStages[0]?.id ?? null);
    if (stageId !== null) {
      const stage = db.stages.find((s) => s.id === stageId)!;
      if (stage.pipeline !== pipelineId) {
        err(400, { stage: ['Stage does not belong to the selected pipeline.'] });
      }
    }
    const fullName = `${lead.first_name} ${lead.last_name}`.trim();
    const org = db.organizations.find((o) => o.id === ctx.orgId)!;
    const deal: DDeal = {
      id: nextId(db), organization: ctx.orgId,
      title: String(ctx.body.deal_title ?? '').trim() || `${fullName} deal`,
      value: decStr(ctx.body.deal_value) ?? lead.estimated_value ?? '0.00',
      currency: org.currency, pipeline: pipelineId!, stage: stageId, contact: contact.id,
      company: companyId, owner: lead.owner, status: 'open', expected_close_date: null,
      closed_at: null, lost_reason: '', description: '', tags: [], created_at: now(), updated_at: now(),
    };
    db.deals.push(deal);
    dealId = deal.id;
  }

  lead.status = 'converted';
  lead.converted_at = now();
  lead.converted_contact = contact.id;
  lead.converted_deal = dealId;
  lead.updated_at = now();
  return ok({ lead: leadS(db, lead), contact_id: contact.id, company_id: companyId, deal_id: dealId });
});

// --- Dispatcher -----------------------------------------------------------------

function parseBody(data: unknown): Record<string, unknown> {
  if (typeof data === 'string' && data) {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  return {};
}

export function handle(req: DemoRequest): DemoResponse {
  const db = getDb();
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const match = req.path.match(r.pattern);
      if (!match) continue;

      let ctx: Ctx;
      if (r.auth) {
        const authHeader = req.headers.authorization ?? '';
        const tokenMatch = authHeader.match(/^Bearer demo-access-(\d+)$/);
        const user = tokenMatch ? db.users.find((u) => u.id === Number(tokenMatch[1])) : undefined;
        if (!user) {
          return { status: 401, data: { detail: 'Authentication credentials were not provided.' } };
        }
        const orgHeader = req.headers['x-organization'];
        const memberships = db.memberships
          .filter((m) => m.user === user.id && m.is_active)
          .sort((a, b) => a.id - b.id);
        const membership = orgHeader
          ? memberships.find((m) => String(m.organization) === String(orgHeader))
          : memberships[0];
        if (!membership) {
          return { status: 403, data: { detail: 'You are not an active member of this organization.' } };
        }
        ctx = {
          db, user, membership, orgId: membership.organization,
          body: parseBody(req.data), params: req.params ?? {},
        };
      } else {
        ctx = {
          db,
          user: null as unknown as DUser,
          membership: null as unknown as DMembership,
          orgId: 0,
          body: parseBody(req.data),
          params: req.params ?? {},
        };
      }

      const result = r.handler(ctx, match);
      persist();
      return { status: result.status ?? 200, data: result.data ?? null };
    }
    return { status: 404, data: { detail: `No demo route for ${req.method} ${req.path}` } };
  } catch (error) {
    if (error instanceof ApiError) return { status: error.status, data: error.body };
    throw error;
  }
}

// Shared internals for the second half of the route table (routes2.ts).
export {
  applyFilters,
  asBool,
  companyBrief,
  contactBrief,
  decStr,
  deleteDeal,
  eqBool,
  eqId,
  eqStr,
  err,
  hasTag,
  memberFk,
  notFound,
  now,
  ok,
  order,
  orgFk,
  orgTags,
  paginate,
  requireAdmin,
  route,
  search,
  stageS,
  pipelineS,
  dealS,
  activityS,
  noteS,
  employeeS,
  ticketS,
  userBrief,
};
export type { Ctx };

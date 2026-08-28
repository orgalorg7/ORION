// ---------------------------------------------------------------------------
// Demo mode routes, part 2: pipelines, stages, deals, activities, notes,
// HR, tickets and the analytics dashboard. Imported for its side effects.
// ---------------------------------------------------------------------------

import {
  activityS,
  applyFilters,
  asBool,
  companyBrief,
  contactBrief,
  dealS,
  decStr,
  deleteDeal,
  employeeS,
  eqBool,
  eqId,
  eqStr,
  err,
  hasTag,
  memberFk,
  noteS,
  notFound,
  now,
  ok,
  order,
  orgFk,
  orgTags,
  paginate,
  pipelineS,
  route,
  search,
  stageS,
  ticketS,
  userBrief,
  type Ctx,
} from './backend';
import {
  nextId,
  type DActivity,
  type DDeal,
  type DEmployee,
  type DNote,
  type DTicket,
} from './store';

// --- Pipelines & stages -----------------------------------------------------

route('GET', /^\/pipelines\/$/, (ctx) =>
  ok(
    ctx.db.pipelines
      .filter((p) => p.organization === ctx.orgId)
      .sort((a, b) => a.id - b.id)
      .map((p) => pipelineS(ctx.db, p.id)),
  ),
);

route('POST', /^\/pipelines\/$/, (ctx) => {
  const name = String(ctx.body.name ?? '').trim();
  if (!name) err(400, { name: ['This field is required.'] });
  const orgPipelines = ctx.db.pipelines.filter((p) => p.organization === ctx.orgId);
  const isDefault = asBool(ctx.body.is_default) || orgPipelines.length === 0;
  if (isDefault) for (const p of orgPipelines) p.is_default = false;
  const pipeline = {
    id: nextId(ctx.db), organization: ctx.orgId, name, is_default: isDefault,
    created_at: now(), updated_at: now(),
  };
  ctx.db.pipelines.push(pipeline);
  return ok(pipelineS(ctx.db, pipeline.id), 201);
});

route('PATCH', /^\/pipelines\/(\d+)\/$/, (ctx, match) => {
  const pipeline = ctx.db.pipelines.find((p) => p.id === Number(match[1]) && p.organization === ctx.orgId);
  if (!pipeline) return notFound();
  if (ctx.body.name !== undefined) pipeline.name = String(ctx.body.name);
  if (ctx.body.is_default !== undefined && asBool(ctx.body.is_default)) {
    for (const p of ctx.db.pipelines) {
      if (p.organization === ctx.orgId) p.is_default = p.id === pipeline.id;
    }
  }
  pipeline.updated_at = now();
  return ok(pipelineS(ctx.db, pipeline.id));
});

route('DELETE', /^\/pipelines\/(\d+)\/$/, (ctx, match) => {
  const pipeline = ctx.db.pipelines.find((p) => p.id === Number(match[1]) && p.organization === ctx.orgId);
  if (!pipeline) return notFound();
  const orgPipelines = ctx.db.pipelines.filter((p) => p.organization === ctx.orgId);
  if (orgPipelines.length <= 1) {
    err(400, { detail: 'Cannot delete the only pipeline in the organization.' });
  }
  for (const deal of ctx.db.deals.filter((d) => d.pipeline === pipeline.id)) {
    deleteDeal(ctx.db, deal.id);
  }
  ctx.db.stages = ctx.db.stages.filter((s) => s.pipeline !== pipeline.id);
  ctx.db.pipelines = ctx.db.pipelines.filter((p) => p.id !== pipeline.id);
  if (pipeline.is_default) {
    const first = ctx.db.pipelines.find((p) => p.organization === ctx.orgId);
    if (first) first.is_default = true;
  }
  return { status: 204, data: null };
});

route('POST', /^\/stages\/$/, (ctx) => {
  const pipelineId = orgFk(ctx, ctx.db.pipelines, ctx.body.pipeline, 'pipeline');
  if (pipelineId === null) err(400, { pipeline: ['This field is required.'] });
  const name = String(ctx.body.name ?? '').trim();
  if (!name) err(400, { name: ['This field is required.'] });
  const stage = {
    id: nextId(ctx.db), organization: ctx.orgId, pipeline: pipelineId!, name,
    order: Number(ctx.body.order ?? 0) || 0,
    probability: Number(ctx.body.probability ?? 0) || 0,
    color: String(ctx.body.color ?? '#94a3b8'),
    created_at: now(), updated_at: now(),
  };
  ctx.db.stages.push(stage);
  return ok(stageS(ctx.db, stage.id), 201);
});

route('PATCH', /^\/stages\/(\d+)\/$/, (ctx, match) => {
  const stage = ctx.db.stages.find((s) => s.id === Number(match[1]) && s.organization === ctx.orgId);
  if (!stage) return notFound();
  if (ctx.body.name !== undefined) stage.name = String(ctx.body.name);
  if (ctx.body.order !== undefined) stage.order = Number(ctx.body.order) || 0;
  if (ctx.body.probability !== undefined) stage.probability = Number(ctx.body.probability) || 0;
  if (ctx.body.color !== undefined) stage.color = String(ctx.body.color);
  stage.updated_at = now();
  return ok(stageS(ctx.db, stage.id));
});

route('DELETE', /^\/stages\/(\d+)\/$/, (ctx, match) => {
  const stage = ctx.db.stages.find((s) => s.id === Number(match[1]) && s.organization === ctx.orgId);
  if (!stage) return notFound();
  for (const deal of ctx.db.deals) if (deal.stage === stage.id) deal.stage = null;
  ctx.db.stages = ctx.db.stages.filter((s) => s.id !== stage.id);
  return { status: 204, data: null };
});

// --- Deals --------------------------------------------------------------------

function dealPayload(ctx: Ctx, body: Record<string, unknown>, target: DDeal, isCreate: boolean) {
  if (body.title !== undefined) target.title = String(body.title ?? '');
  if (isCreate && !target.title.trim()) err(400, { title: ['This field is required.'] });
  if (body.value !== undefined) target.value = decStr(body.value) ?? '0.00';
  if (body.currency !== undefined && body.currency !== '') target.currency = String(body.currency);
  if (body.pipeline !== undefined) {
    const pipelineId = orgFk(ctx, ctx.db.pipelines, body.pipeline, 'pipeline');
    if (pipelineId === null) err(400, { pipeline: ['This field is required.'] });
    target.pipeline = pipelineId!;
  }
  if (body.stage !== undefined) {
    target.stage = orgFk(ctx, ctx.db.stages, body.stage, 'stage');
  }
  if (body.stage !== undefined && target.stage !== null) {
    const stage = ctx.db.stages.find((s) => s.id === target.stage)!;
    if (stage.pipeline !== target.pipeline) {
      err(400, { stage: ['Stage does not belong to the selected pipeline.'] });
    }
  }
  if (body.contact !== undefined) target.contact = orgFk(ctx, ctx.db.contacts, body.contact, 'contact');
  if (body.company !== undefined) target.company = orgFk(ctx, ctx.db.companies, body.company, 'company');
  if (body.owner !== undefined) target.owner = memberFk(ctx, body.owner, 'owner');
  if (body.expected_close_date !== undefined) {
    target.expected_close_date = body.expected_close_date
      ? String(body.expected_close_date).slice(0, 10)
      : null;
  }
  if (body.description !== undefined) target.description = String(body.description ?? '');
  const tags = orgTags(ctx, body.tags);
  if (tags !== undefined) target.tags = tags;
}

route('GET', /^\/deals\/$/, (ctx) => {
  let items = ctx.db.deals.filter((d) => d.organization === ctx.orgId);
  items = applyFilters(items, ctx.params, {
    pipeline: eqId('pipeline') as never,
    stage: eqId('stage') as never,
    status: eqStr('status') as never,
    owner: eqId('owner') as never,
    contact: eqId('contact') as never,
    company: eqId('company') as never,
    tags: hasTag as never,
  });
  items = search(items, ctx.params.search, (d) => {
    const contact = contactBrief(ctx.db, d.contact);
    return [d.title, contact?.first_name, contact?.last_name, companyBrief(ctx.db, d.company)?.name];
  });
  items = order(items, ctx.params.ordering, {
    value: (d) => parseFloat(d.value),
    created_at: (d) => d.created_at,
    expected_close_date: (d) => d.expected_close_date,
  }, '-created_at');
  const page = paginate(items, ctx.params);
  return ok({ ...page, results: page.results.map((d) => dealS(ctx.db, d)) });
});

route('POST', /^\/deals\/$/, (ctx) => {
  const org = ctx.db.organizations.find((o) => o.id === ctx.orgId)!;
  const deal: DDeal = {
    id: nextId(ctx.db), organization: ctx.orgId, title: '', value: '0.00', currency: org.currency,
    pipeline: 0, stage: null, contact: null, company: null, owner: null, status: 'open',
    expected_close_date: null, closed_at: null, lost_reason: '', description: '', tags: [],
    created_at: now(), updated_at: now(),
  };
  if (ctx.body.pipeline === undefined) err(400, { pipeline: ['This field is required.'] });
  dealPayload(ctx, ctx.body, deal, true);
  if (deal.stage === null) {
    const first = ctx.db.stages
      .filter((s) => s.pipeline === deal.pipeline)
      .sort((a, b) => a.order - b.order || a.id - b.id)[0];
    deal.stage = first?.id ?? null;
  }
  ctx.db.deals.push(deal);
  return ok(dealS(ctx.db, deal), 201);
});

route('GET', /^\/deals\/(\d+)\/$/, (ctx, match) => {
  const deal = ctx.db.deals.find((d) => d.id === Number(match[1]) && d.organization === ctx.orgId);
  return deal ? ok(dealS(ctx.db, deal)) : notFound();
});

route('PATCH', /^\/deals\/(\d+)\/$/, (ctx, match) => {
  const deal = ctx.db.deals.find((d) => d.id === Number(match[1]) && d.organization === ctx.orgId);
  if (!deal) return notFound();
  dealPayload(ctx, ctx.body, deal, false);
  deal.updated_at = now();
  return ok(dealS(ctx.db, deal));
});

route('DELETE', /^\/deals\/(\d+)\/$/, (ctx, match) => {
  const deal = ctx.db.deals.find((d) => d.id === Number(match[1]) && d.organization === ctx.orgId);
  if (!deal) return notFound();
  deleteDeal(ctx.db, deal.id);
  return { status: 204, data: null };
});

route('POST', /^\/deals\/(\d+)\/move\/$/, (ctx, match) => {
  const deal = ctx.db.deals.find((d) => d.id === Number(match[1]) && d.organization === ctx.orgId);
  if (!deal) return notFound();
  const stageId = orgFk(ctx, ctx.db.stages, ctx.body.stage, 'stage');
  if (stageId === null) err(400, { stage: ['This field is required.'] });
  const stage = ctx.db.stages.find((s) => s.id === stageId)!;
  if (stage.pipeline !== deal.pipeline) {
    err(400, { stage: ['Stage does not belong to this deal\'s pipeline.'] });
  }
  deal.stage = stageId;
  deal.updated_at = now();
  return ok(dealS(ctx.db, deal));
});

route('POST', /^\/deals\/(\d+)\/mark-won\/$/, (ctx, match) => {
  const deal = ctx.db.deals.find((d) => d.id === Number(match[1]) && d.organization === ctx.orgId);
  if (!deal) return notFound();
  deal.status = 'won';
  deal.closed_at = now();
  deal.lost_reason = '';
  deal.updated_at = now();
  return ok(dealS(ctx.db, deal));
});

route('POST', /^\/deals\/(\d+)\/mark-lost\/$/, (ctx, match) => {
  const deal = ctx.db.deals.find((d) => d.id === Number(match[1]) && d.organization === ctx.orgId);
  if (!deal) return notFound();
  deal.status = 'lost';
  deal.closed_at = now();
  deal.lost_reason = String(ctx.body.lost_reason ?? '');
  deal.updated_at = now();
  return ok(dealS(ctx.db, deal));
});

route('POST', /^\/deals\/(\d+)\/reopen\/$/, (ctx, match) => {
  const deal = ctx.db.deals.find((d) => d.id === Number(match[1]) && d.organization === ctx.orgId);
  if (!deal) return notFound();
  deal.status = 'open';
  deal.closed_at = null;
  deal.lost_reason = '';
  deal.updated_at = now();
  return ok(dealS(ctx.db, deal));
});

// --- Activities & notes ----------------------------------------------------------

function activityPayload(ctx: Ctx, body: Record<string, unknown>, target: DActivity, isCreate: boolean) {
  if (body.type !== undefined) {
    const value = String(body.type);
    if (!['call', 'email', 'meeting', 'task'].includes(value)) {
      err(400, { type: [`"${value}" is not a valid choice.`] });
    }
    target.type = value as DActivity['type'];
  }
  if (body.title !== undefined) target.title = String(body.title ?? '');
  if (isCreate && !target.title.trim()) err(400, { title: ['This field is required.'] });
  if (body.description !== undefined) target.description = String(body.description ?? '');
  if (body.due_at !== undefined) target.due_at = body.due_at ? String(body.due_at) : null;
  if (body.assigned_to !== undefined) target.assigned_to = memberFk(ctx, body.assigned_to, 'assigned_to');
  if (body.contact !== undefined) target.contact = orgFk(ctx, ctx.db.contacts, body.contact, 'contact');
  if (body.company !== undefined) target.company = orgFk(ctx, ctx.db.companies, body.company, 'company');
  if (body.deal !== undefined) target.deal = orgFk(ctx, ctx.db.deals, body.deal, 'deal');
  if (body.lead !== undefined) target.lead = orgFk(ctx, ctx.db.leads, body.lead, 'lead');
  if (body.completed !== undefined) {
    target.completed = Boolean(body.completed);
    target.completed_at = target.completed ? now() : null;
  }
}

route('GET', /^\/activities\/$/, (ctx) => {
  let items = ctx.db.activities.filter((a) => a.organization === ctx.orgId);
  items = applyFilters(items, ctx.params, {
    type: eqStr('type') as never,
    completed: eqBool('completed') as never,
    assigned_to: eqId('assigned_to') as never,
    contact: eqId('contact') as never,
    company: eqId('company') as never,
    deal: eqId('deal') as never,
    lead: eqId('lead') as never,
    due_before: ((a: DActivity, value: string) => a.due_at !== null && a.due_at <= value) as never,
    due_after: ((a: DActivity, value: string) => a.due_at !== null && a.due_at >= value) as never,
  });
  items = search(items, ctx.params.search, (a) => [a.title, a.description]);
  items = order(items, ctx.params.ordering, {
    due_at: (a) => a.due_at,
    created_at: (a) => a.created_at,
    completed_at: (a) => a.completed_at,
  }, '');
  if (!String(ctx.params.ordering ?? '').trim()) {
    items = [...items].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (a.due_at !== b.due_at) {
        if (a.due_at === null) return 1;
        if (b.due_at === null) return -1;
        return a.due_at.localeCompare(b.due_at);
      }
      return b.created_at.localeCompare(a.created_at);
    });
  }
  const page = paginate(items, ctx.params);
  return ok({ ...page, results: page.results.map((a) => activityS(ctx.db, a)) });
});

route('POST', /^\/activities\/$/, (ctx) => {
  const activity: DActivity = {
    id: nextId(ctx.db), organization: ctx.orgId, type: 'task', title: '', description: '',
    due_at: null, completed: false, completed_at: null, assigned_to: null,
    contact: null, company: null, deal: null, lead: null, created_at: now(), updated_at: now(),
  };
  activityPayload(ctx, ctx.body, activity, true);
  ctx.db.activities.push(activity);
  return ok(activityS(ctx.db, activity), 201);
});

route('GET', /^\/activities\/(\d+)\/$/, (ctx, match) => {
  const activity = ctx.db.activities.find((a) => a.id === Number(match[1]) && a.organization === ctx.orgId);
  return activity ? ok(activityS(ctx.db, activity)) : notFound();
});

route('PATCH', /^\/activities\/(\d+)\/$/, (ctx, match) => {
  const activity = ctx.db.activities.find((a) => a.id === Number(match[1]) && a.organization === ctx.orgId);
  if (!activity) return notFound();
  activityPayload(ctx, ctx.body, activity, false);
  activity.updated_at = now();
  return ok(activityS(ctx.db, activity));
});

route('DELETE', /^\/activities\/(\d+)\/$/, (ctx, match) => {
  const before = ctx.db.activities.length;
  ctx.db.activities = ctx.db.activities.filter(
    (a) => !(a.id === Number(match[1]) && a.organization === ctx.orgId),
  );
  return ctx.db.activities.length === before ? notFound() : { status: 204, data: null };
});

route('POST', /^\/activities\/(\d+)\/complete\/$/, (ctx, match) => {
  const activity = ctx.db.activities.find((a) => a.id === Number(match[1]) && a.organization === ctx.orgId);
  if (!activity) return notFound();
  activity.completed = ctx.body.completed === undefined ? true : Boolean(ctx.body.completed);
  activity.completed_at = activity.completed ? now() : null;
  activity.updated_at = now();
  return ok(activityS(ctx.db, activity));
});

route('GET', /^\/notes\/$/, (ctx) => {
  let items = ctx.db.notes.filter((n) => n.organization === ctx.orgId);
  items = applyFilters(items, ctx.params, {
    contact: eqId('contact') as never,
    company: eqId('company') as never,
    deal: eqId('deal') as never,
    lead: eqId('lead') as never,
  });
  items = [...items].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const page = paginate(items, ctx.params);
  return ok({ ...page, results: page.results.map((n) => noteS(ctx.db, n)) });
});

route('POST', /^\/notes\/$/, (ctx) => {
  const body = String(ctx.body.body ?? '').trim();
  if (!body) err(400, { body: ['This field is required.'] });
  const note: DNote = {
    id: nextId(ctx.db), organization: ctx.orgId, body, author: ctx.user.id,
    contact: ctx.body.contact !== undefined ? orgFk(ctx, ctx.db.contacts, ctx.body.contact, 'contact') : null,
    company: ctx.body.company !== undefined ? orgFk(ctx, ctx.db.companies, ctx.body.company, 'company') : null,
    deal: ctx.body.deal !== undefined ? orgFk(ctx, ctx.db.deals, ctx.body.deal, 'deal') : null,
    lead: ctx.body.lead !== undefined ? orgFk(ctx, ctx.db.leads, ctx.body.lead, 'lead') : null,
    created_at: now(), updated_at: now(),
  };
  ctx.db.notes.push(note);
  return ok(noteS(ctx.db, note), 201);
});

route('PATCH', /^\/notes\/(\d+)\/$/, (ctx, match) => {
  const note = ctx.db.notes.find((n) => n.id === Number(match[1]) && n.organization === ctx.orgId);
  if (!note) return notFound();
  if (ctx.body.body !== undefined) note.body = String(ctx.body.body);
  note.updated_at = now();
  return ok(noteS(ctx.db, note));
});

route('DELETE', /^\/notes\/(\d+)\/$/, (ctx, match) => {
  const before = ctx.db.notes.length;
  ctx.db.notes = ctx.db.notes.filter((n) => !(n.id === Number(match[1]) && n.organization === ctx.orgId));
  return ctx.db.notes.length === before ? notFound() : { status: 204, data: null };
});

// --- HR ----------------------------------------------------------------------------

route('GET', /^\/departments\/$/, (ctx) => {
  let items = ctx.db.departments.filter((d) => d.organization === ctx.orgId);
  items = search(items, ctx.params.search, (d) => [d.name]);
  return ok(
    [...items]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => ({
        id: d.id, name: d.name, description: d.description,
        employees_count: ctx.db.employees.filter((e) => e.department === d.id).length,
        created_at: d.created_at,
      })),
  );
});

route('POST', /^\/departments\/$/, (ctx) => {
  const name = String(ctx.body.name ?? '').trim();
  if (!name) err(400, { name: ['This field is required.'] });
  const department = {
    id: nextId(ctx.db), organization: ctx.orgId, name,
    description: String(ctx.body.description ?? ''), created_at: now(), updated_at: now(),
  };
  ctx.db.departments.push(department);
  return ok({ id: department.id, name, description: department.description, employees_count: 0, created_at: department.created_at }, 201);
});

route('PATCH', /^\/departments\/(\d+)\/$/, (ctx, match) => {
  const department = ctx.db.departments.find((d) => d.id === Number(match[1]) && d.organization === ctx.orgId);
  if (!department) return notFound();
  if (ctx.body.name !== undefined) department.name = String(ctx.body.name);
  if (ctx.body.description !== undefined) department.description = String(ctx.body.description);
  department.updated_at = now();
  return ok({
    id: department.id, name: department.name, description: department.description,
    employees_count: ctx.db.employees.filter((e) => e.department === department.id).length,
    created_at: department.created_at,
  });
});

route('DELETE', /^\/departments\/(\d+)\/$/, (ctx, match) => {
  const id = Number(match[1]);
  if (!ctx.db.departments.some((d) => d.id === id && d.organization === ctx.orgId)) return notFound();
  for (const employee of ctx.db.employees) if (employee.department === id) employee.department = null;
  ctx.db.departments = ctx.db.departments.filter((d) => d.id !== id);
  return { status: 204, data: null };
});

function employeePayload(ctx: Ctx, body: Record<string, unknown>, target: DEmployee, isCreate: boolean) {
  for (const field of [
    'first_name', 'last_name', 'email', 'phone', 'job_title', 'city', 'country',
  ] as const) {
    if (body[field] !== undefined) target[field] = String(body[field] ?? '');
  }
  if (isCreate && !target.first_name.trim()) err(400, { first_name: ['This field is required.'] });
  if (body.employment_type !== undefined) target.employment_type = String(body.employment_type);
  if (body.status !== undefined) target.status = String(body.status);
  if (body.hire_date !== undefined) target.hire_date = body.hire_date ? String(body.hire_date).slice(0, 10) : null;
  if (body.salary !== undefined) target.salary = decStr(body.salary);
  if (body.department !== undefined) target.department = orgFk(ctx, ctx.db.departments, body.department, 'department');
  if (body.user !== undefined) target.user = memberFk(ctx, body.user, 'user');
  if (body.manager !== undefined) {
    const manager = orgFk(ctx, ctx.db.employees, body.manager, 'manager');
    if (manager !== null && manager === target.id) {
      err(400, { manager: ['An employee cannot be their own manager.'] });
    }
    target.manager = manager;
  }
}

route('GET', /^\/employees\/$/, (ctx) => {
  let items = ctx.db.employees.filter((e) => e.organization === ctx.orgId);
  items = applyFilters(items, ctx.params, {
    department: eqId('department') as never,
    status: eqStr('status') as never,
    employment_type: eqStr('employment_type') as never,
    manager: eqId('manager') as never,
  });
  items = search(items, ctx.params.search, (e) => [e.first_name, e.last_name, e.email, e.job_title]);
  items = order(items, ctx.params.ordering, {
    first_name: (e) => e.first_name,
    hire_date: (e) => e.hire_date,
    created_at: (e) => e.created_at,
  }, '-created_at');
  const page = paginate(items, ctx.params);
  return ok({ ...page, results: page.results.map((e) => employeeS(ctx.db, e)) });
});

route('POST', /^\/employees\/$/, (ctx) => {
  const employee: DEmployee = {
    id: nextId(ctx.db), organization: ctx.orgId, first_name: '', last_name: '', email: '', phone: '',
    user: null, department: null, job_title: '', employment_type: 'full_time', status: 'active',
    hire_date: null, salary: null, manager: null, city: '', country: '',
    created_at: now(), updated_at: now(),
  };
  employeePayload(ctx, ctx.body, employee, true);
  ctx.db.employees.push(employee);
  return ok(employeeS(ctx.db, employee), 201);
});

route('GET', /^\/employees\/(\d+)\/$/, (ctx, match) => {
  const employee = ctx.db.employees.find((e) => e.id === Number(match[1]) && e.organization === ctx.orgId);
  return employee ? ok(employeeS(ctx.db, employee)) : notFound();
});

route('PATCH', /^\/employees\/(\d+)\/$/, (ctx, match) => {
  const employee = ctx.db.employees.find((e) => e.id === Number(match[1]) && e.organization === ctx.orgId);
  if (!employee) return notFound();
  employeePayload(ctx, ctx.body, employee, false);
  employee.updated_at = now();
  return ok(employeeS(ctx.db, employee));
});

route('DELETE', /^\/employees\/(\d+)\/$/, (ctx, match) => {
  const id = Number(match[1]);
  if (!ctx.db.employees.some((e) => e.id === id && e.organization === ctx.orgId)) return notFound();
  for (const employee of ctx.db.employees) if (employee.manager === id) employee.manager = null;
  ctx.db.employees = ctx.db.employees.filter((e) => e.id !== id);
  return { status: 204, data: null };
});

// --- Tickets --------------------------------------------------------------------------

function ticketPayload(ctx: Ctx, body: Record<string, unknown>, target: DTicket, isCreate: boolean) {
  if (body.subject !== undefined) target.subject = String(body.subject ?? '');
  if (isCreate && !target.subject.trim()) err(400, { subject: ['This field is required.'] });
  if (body.description !== undefined) target.description = String(body.description ?? '');
  if (body.status !== undefined) target.status = String(body.status);
  if (body.priority !== undefined) target.priority = String(body.priority);
  if (body.category !== undefined) target.category = String(body.category);
  if (body.contact !== undefined) target.contact = orgFk(ctx, ctx.db.contacts, body.contact, 'contact');
  if (body.assigned_to !== undefined) target.assigned_to = memberFk(ctx, body.assigned_to, 'assigned_to');
}

route('GET', /^\/tickets\/$/, (ctx) => {
  let items = ctx.db.tickets.filter((t) => t.organization === ctx.orgId);
  items = applyFilters(items, ctx.params, {
    status: eqStr('status') as never,
    priority: eqStr('priority') as never,
    category: eqStr('category') as never,
    assigned_to: eqId('assigned_to') as never,
    contact: eqId('contact') as never,
  });
  items = search(items, ctx.params.search, (t) => [t.subject, t.description]);
  items = order(items, ctx.params.ordering, {
    created_at: (t) => t.created_at,
    updated_at: (t) => t.updated_at,
  }, '-created_at');
  const page = paginate(items, ctx.params);
  return ok({ ...page, results: page.results.map((t) => ticketS(ctx.db, t)) });
});

route('POST', /^\/tickets\/$/, (ctx) => {
  const number =
    ctx.db.tickets.filter((t) => t.organization === ctx.orgId).reduce((max, t) => Math.max(max, t.number), 0) + 1;
  const ticket: DTicket = {
    id: nextId(ctx.db), organization: ctx.orgId, number, subject: '', description: '',
    contact: null, status: 'open', priority: 'medium', category: 'general', assigned_to: null,
    created_at: now(), updated_at: now(),
  };
  ticketPayload(ctx, ctx.body, ticket, true);
  ctx.db.tickets.push(ticket);
  return ok(ticketS(ctx.db, ticket), 201);
});

route('GET', /^\/tickets\/(\d+)\/$/, (ctx, match) => {
  const ticket = ctx.db.tickets.find((t) => t.id === Number(match[1]) && t.organization === ctx.orgId);
  return ticket ? ok(ticketS(ctx.db, ticket)) : notFound();
});

route('PATCH', /^\/tickets\/(\d+)\/$/, (ctx, match) => {
  const ticket = ctx.db.tickets.find((t) => t.id === Number(match[1]) && t.organization === ctx.orgId);
  if (!ticket) return notFound();
  ticketPayload(ctx, ctx.body, ticket, false);
  ticket.updated_at = now();
  return ok(ticketS(ctx.db, ticket));
});

route('DELETE', /^\/tickets\/(\d+)\/$/, (ctx, match) => {
  const ticket = ctx.db.tickets.find((t) => t.id === Number(match[1]) && t.organization === ctx.orgId);
  if (!ticket) return notFound();
  ctx.db.ticketComments = ctx.db.ticketComments.filter((c) => c.ticket !== ticket.id);
  ctx.db.tickets = ctx.db.tickets.filter((t) => t.id !== ticket.id);
  return { status: 204, data: null };
});

const commentS = (ctx: Ctx, comment: (typeof ctx.db.ticketComments)[number]) => ({
  id: comment.id, author: comment.author, author_detail: userBrief(ctx.db, comment.author),
  body: comment.body, is_internal: comment.is_internal, created_at: comment.created_at,
});

route('GET', /^\/tickets\/(\d+)\/comments\/$/, (ctx, match) => {
  const ticket = ctx.db.tickets.find((t) => t.id === Number(match[1]) && t.organization === ctx.orgId);
  if (!ticket) return notFound();
  const comments = ctx.db.ticketComments
    .filter((c) => c.ticket === ticket.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  return ok(comments.map((c) => commentS(ctx, c)));
});

route('POST', /^\/tickets\/(\d+)\/comments\/$/, (ctx, match) => {
  const ticket = ctx.db.tickets.find((t) => t.id === Number(match[1]) && t.organization === ctx.orgId);
  if (!ticket) return notFound();
  const body = String(ctx.body.body ?? '').trim();
  if (!body) err(400, { body: ['This field is required.'] });
  const comment = {
    id: nextId(ctx.db), ticket: ticket.id, author: ctx.user.id, body,
    is_internal: Boolean(ctx.body.is_internal), created_at: now(), updated_at: now(),
  };
  ctx.db.ticketComments.push(comment);
  return ok(commentS(ctx, comment), 201);
});

// --- Analytics -------------------------------------------------------------------------

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

route('GET', /^\/analytics\/dashboard\/$/, (ctx) => {
  const db = ctx.db;
  const orgId = ctx.orgId;
  const nowDate = new Date();
  const currentMonth = monthKey(nowDate);
  const nowIso = nowDate.toISOString();

  const contacts = db.contacts.filter((c) => c.organization === orgId);
  const companies = db.companies.filter((c) => c.organization === orgId);
  const leads = db.leads.filter((l) => l.organization === orgId);
  const deals = db.deals.filter((d) => d.organization === orgId);
  const activities = db.activities.filter((a) => a.organization === orgId);
  const tickets = db.tickets.filter((t) => t.organization === orgId);
  const employees = db.employees.filter((e) => e.organization === orgId);

  const openDeals = deals.filter((d) => d.status === 'open');
  const wonThisMonth = deals.filter(
    (d) => d.status === 'won' && d.closed_at !== null && monthKey(new Date(d.closed_at)) === currentMonth,
  );
  const sum = (items: DDeal[]) => items.reduce((acc, d) => acc + (parseFloat(d.value) || 0), 0);

  const pipelineParam = ctx.params.pipeline ? Number(ctx.params.pipeline) : null;
  const orgPipelines = db.pipelines.filter((p) => p.organization === orgId);
  const pipeline =
    (pipelineParam ? orgPipelines.find((p) => p.id === pipelineParam) : undefined) ??
    orgPipelines.find((p) => p.is_default) ??
    orgPipelines[0];
  const dealsByStage = pipeline
    ? db.stages
        .filter((s) => s.pipeline === pipeline.id)
        .sort((a, b) => a.order - b.order || a.id - b.id)
        .map((stage) => {
          const stageDeals = openDeals.filter((d) => d.stage === stage.id);
          return {
            stage_id: stage.id, stage_name: stage.name, color: stage.color,
            count: stageDeals.length, value: sum(stageDeals),
          };
        })
    : [];

  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    months.push(monthKey(new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1)));
  }
  const revenueByMonth = months.map((month) => {
    const monthDeals = deals.filter(
      (d) => d.status === 'won' && d.closed_at !== null && monthKey(new Date(d.closed_at)) === month,
    );
    return { month, value: sum(monthDeals), count: monthDeals.length };
  });

  const sourceCounts = new Map<string, number>();
  for (const lead of leads) {
    const source = lead.source || 'other';
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
  }
  const leadsBySource = [...sourceCounts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  const leadsByStatus = ['new', 'contacted', 'qualified', 'unqualified', 'converted'].map((status) => ({
    status,
    count: leads.filter((l) => l.status === status).length,
  }));

  const activityItem = (a: DActivity) => ({
    id: a.id, type: a.type, title: a.title, due_at: a.due_at, completed: a.completed, created_at: a.created_at,
  });
  const recentActivities = [...activities]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5)
    .map(activityItem);
  const upcomingActivities = activities
    .filter((a) => !a.completed && a.due_at !== null && a.due_at >= nowIso)
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''))
    .slice(0, 5)
    .map(activityItem);

  const topDeals = [...openDeals]
    .sort((a, b) => parseFloat(b.value) - parseFloat(a.value))
    .slice(0, 5)
    .map((d) => ({
      id: d.id, title: d.title, value: parseFloat(d.value) || 0, currency: d.currency,
      stage_name: db.stages.find((s) => s.id === d.stage)?.name ?? '',
      company_name: db.companies.find((c) => c.id === d.company)?.name ?? '',
    }));

  return ok({
    totals: {
      contacts: contacts.length,
      companies: companies.length,
      open_deals: openDeals.length,
      open_deals_value: sum(openDeals),
      won_deals_this_month: wonThisMonth.length,
      won_value_this_month: sum(wonThisMonth),
      new_leads_this_month: leads.filter((l) => monthKey(new Date(l.created_at)) === currentMonth).length,
      open_tickets: tickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length,
      active_employees: employees.filter((e) => e.status === 'active').length,
    },
    deals_by_stage: dealsByStage,
    revenue_by_month: revenueByMonth,
    leads_by_source: leadsBySource,
    leads_by_status: leadsByStatus,
    recent_activities: recentActivities,
    upcoming_activities: upcomingActivities,
    top_deals: topDeals,
  });
});

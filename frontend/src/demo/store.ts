// ---------------------------------------------------------------------------
// Demo mode: an in-browser data store that stands in for the Django database.
// Persisted per-viewer in localStorage; re-seeded automatically when empty.
// ---------------------------------------------------------------------------

export interface DUser {
  id: number;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone: string;
  language: 'en' | 'ar';
  date_joined: string;
}

export interface DOrg {
  id: number;
  name: string;
  slug: string;
  industry: string;
  size: string;
  country: string;
  website: string;
  currency: string;
  default_language: string;
  created_at: string;
}

export interface DMembership {
  id: number;
  user: number;
  organization: number;
  role: 'owner' | 'admin' | 'manager' | 'member';
  is_active: boolean;
  created_at: string;
}

export interface DPlan {
  id: number;
  code: string;
  name: string;
  name_ar: string;
  price_monthly: string;
  max_users: number;
  max_contacts: number;
  features: string[];
  is_default: boolean;
  sort_order: number;
}

export interface DSubscription {
  id: number;
  organization: number;
  plan: number;
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  trial_end: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface DInvitation {
  id: number;
  organization: number;
  email: string;
  role: 'admin' | 'manager' | 'member' | 'owner';
  invited_by: number | null;
  accepted_at: string | null;
  created_at: string;
}

interface Timestamped {
  id: number;
  organization: number;
  created_at: string;
  updated_at: string;
}

export interface DTag extends Timestamped {
  name: string;
  color: string;
}

export interface DCompany extends Timestamped {
  name: string;
  domain: string;
  industry: string;
  size: string;
  website: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  annual_revenue: string | null;
  description: string;
  owner: number | null;
  tags: number[];
}

export interface DContact extends Timestamped {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  job_title: string;
  company: number | null;
  owner: number | null;
  source: string;
  address: string;
  city: string;
  country: string;
  description: string;
  is_active: boolean;
  tags: number[];
}

export interface DLead extends Timestamped {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company_name: string;
  job_title: string;
  source: string;
  status: string;
  score: number;
  estimated_value: string | null;
  owner: number | null;
  description: string;
  converted_at: string | null;
  converted_contact: number | null;
  converted_deal: number | null;
}

export interface DPipeline extends Timestamped {
  name: string;
  is_default: boolean;
}

export interface DStage extends Timestamped {
  pipeline: number;
  name: string;
  order: number;
  probability: number;
  color: string;
}

export interface DDeal extends Timestamped {
  title: string;
  value: string;
  currency: string;
  pipeline: number;
  stage: number | null;
  contact: number | null;
  company: number | null;
  owner: number | null;
  status: 'open' | 'won' | 'lost';
  expected_close_date: string | null;
  closed_at: string | null;
  lost_reason: string;
  description: string;
  tags: number[];
}

export interface DActivity extends Timestamped {
  type: 'call' | 'email' | 'meeting' | 'task';
  title: string;
  description: string;
  due_at: string | null;
  completed: boolean;
  completed_at: string | null;
  assigned_to: number | null;
  contact: number | null;
  company: number | null;
  deal: number | null;
  lead: number | null;
}

export interface DNote extends Timestamped {
  body: string;
  author: number | null;
  contact: number | null;
  company: number | null;
  deal: number | null;
  lead: number | null;
}

export interface DDepartment extends Timestamped {
  name: string;
  description: string;
}

export interface DEmployee extends Timestamped {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  user: number | null;
  department: number | null;
  job_title: string;
  employment_type: string;
  status: string;
  hire_date: string | null;
  salary: string | null;
  manager: number | null;
  city: string;
  country: string;
}

export interface DTicket extends Timestamped {
  number: number;
  subject: string;
  description: string;
  contact: number | null;
  status: string;
  priority: string;
  category: string;
  assigned_to: number | null;
}

export interface DTicketComment {
  id: number;
  ticket: number;
  author: number | null;
  body: string;
  is_internal: boolean;
  created_at: string;
  updated_at: string;
}

export interface DB {
  seq: number;
  users: DUser[];
  organizations: DOrg[];
  memberships: DMembership[];
  plans: DPlan[];
  subscriptions: DSubscription[];
  invitations: DInvitation[];
  tags: DTag[];
  companies: DCompany[];
  contacts: DContact[];
  leads: DLead[];
  pipelines: DPipeline[];
  stages: DStage[];
  deals: DDeal[];
  activities: DActivity[];
  notes: DNote[];
  departments: DDepartment[];
  employees: DEmployee[];
  tickets: DTicket[];
  ticketComments: DTicketComment[];
}

const STORAGE_KEY = 'hammerload-demo-db-v1';

let db: DB | null = null;

export function nextId(database: DB): number {
  database.seq += 1;
  return database.seq;
}

export function persist(): void {
  if (!db) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // Private browsing / quota — the demo keeps working in memory.
  }
}

export function resetDb(): DB {
  db = seed();
  persist();
  return db;
}

export function getDb(): DB {
  if (db) return db;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DB;
      if (parsed && Array.isArray(parsed.users) && parsed.users.length > 0) {
        db = parsed;
        return db;
      }
    }
  } catch {
    // fall through to a fresh seed
  }
  return resetDb();
}

// --- Seeding ----------------------------------------------------------------

const DEFAULT_STAGES = [
  { name: 'Qualification', order: 0, probability: 10, color: '#94a3b8' },
  { name: 'Meeting', order: 1, probability: 25, color: '#60a5fa' },
  { name: 'Proposal', order: 2, probability: 50, color: '#a78bfa' },
  { name: 'Negotiation', order: 3, probability: 75, color: '#fbbf24' },
  { name: 'Closing', order: 4, probability: 90, color: '#34d399' },
];

export const DEFAULT_PLANS: Omit<DPlan, 'id'>[] = [
  {
    code: 'free', name: 'Free', name_ar: 'مجاني', price_monthly: '0.00',
    max_users: 3, max_contacts: 500, is_default: true, sort_order: 0,
    features: ['contacts', 'companies', 'leads', 'deals', 'activities'],
  },
  {
    code: 'pro', name: 'Pro', name_ar: 'احترافي', price_monthly: '29.00',
    max_users: 25, max_contacts: 25000, is_default: false, sort_order: 1,
    features: ['contacts', 'companies', 'leads', 'deals', 'activities', 'tickets', 'employees', 'analytics'],
  },
  {
    code: 'business', name: 'Business', name_ar: 'أعمال', price_monthly: '79.00',
    max_users: 100, max_contacts: 100000, is_default: false, sort_order: 2,
    features: [
      'contacts', 'companies', 'leads', 'deals', 'activities',
      'tickets', 'employees', 'analytics', 'priority_support', 'api_access',
    ],
  },
];

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function daysAhead(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function dateAhead(days: number): string {
  return daysAhead(days).slice(0, 10);
}

export function slugify(value: string): string {
  return (
    value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'organization'
  );
}

/** Create org-level defaults: default pipeline + stages. Returns the pipeline id. */
export function createDefaultPipeline(database: DB, orgId: number): number {
  const now = new Date().toISOString();
  const pipeline: DPipeline = {
    id: nextId(database), organization: orgId, name: 'Sales Pipeline',
    is_default: true, created_at: now, updated_at: now,
  };
  database.pipelines.push(pipeline);
  for (const stage of DEFAULT_STAGES) {
    database.stages.push({
      id: nextId(database), organization: orgId, pipeline: pipeline.id,
      created_at: now, updated_at: now, ...stage,
    });
  }
  return pipeline.id;
}

export function ensurePlans(database: DB): void {
  if (database.plans.length === 0) {
    for (const plan of DEFAULT_PLANS) {
      database.plans.push({ id: nextId(database), ...plan });
    }
  }
}

function seed(): DB {
  const database: DB = {
    seq: 0,
    users: [], organizations: [], memberships: [], plans: [], subscriptions: [],
    invitations: [], tags: [], companies: [], contacts: [], leads: [],
    pipelines: [], stages: [], deals: [], activities: [], notes: [],
    departments: [], employees: [], tickets: [], ticketComments: [],
  };
  ensurePlans(database);
  const now = new Date().toISOString();

  const owner: DUser = {
    id: nextId(database), email: 'demo@crm.com', password: 'demo1234',
    first_name: 'Demo', last_name: 'Admin', phone: '', language: 'en', date_joined: daysAgo(120),
  };
  const teammate: DUser = {
    id: nextId(database), email: 'sales@crm.com', password: 'demo1234',
    first_name: 'Layla', last_name: 'Hassan', phone: '', language: 'en', date_joined: daysAgo(100),
  };
  database.users.push(owner, teammate);

  const org: DOrg = {
    id: nextId(database), name: 'Acme Trading', slug: 'acme-trading', industry: 'Trading',
    size: '11-50', country: 'Egypt', website: '', currency: 'USD', default_language: 'en',
    created_at: daysAgo(120),
  };
  database.organizations.push(org);
  database.memberships.push(
    { id: nextId(database), user: owner.id, organization: org.id, role: 'owner', is_active: true, created_at: daysAgo(120) },
    { id: nextId(database), user: teammate.id, organization: org.id, role: 'manager', is_active: true, created_at: daysAgo(100) },
  );
  database.subscriptions.push({
    id: nextId(database), organization: org.id,
    plan: database.plans.find((p) => p.code === 'pro')!.id,
    status: 'active', trial_end: null, current_period_end: daysAhead(22), cancel_at_period_end: false,
  });
  const pipelineId = createDefaultPipeline(database, org.id);
  const stages = database.stages.filter((s) => s.pipeline === pipelineId);

  const t = (partial: { name: string; color: string }): DTag => {
    const tag: DTag = { id: nextId(database), organization: org.id, created_at: now, updated_at: now, ...partial };
    database.tags.push(tag);
    return tag;
  };
  const tagVip = t({ name: 'VIP', color: '#f59e0b' });
  const tagPartner = t({ name: 'Partner', color: '#10b981' });
  t({ name: 'Newsletter', color: '#d5a928' });

  const mkCompany = (
    name: string, domain: string, industry: string, city: string, country: string, revenue: string,
  ): DCompany => {
    const company: DCompany = {
      id: nextId(database), organization: org.id, name, domain, industry,
      size: '11-50', website: '', email: '', phone: '', address: '', city, country,
      annual_revenue: revenue, description: '', owner: owner.id, tags: [],
      created_at: daysAgo(90), updated_at: now,
    };
    database.companies.push(company);
    return company;
  };
  const companies = [
    mkCompany('Nile Software', 'nilesoft.io', 'Technology', 'Cairo', 'Egypt', '250000.00'),
    mkCompany('Gulf Logistics', 'gulflog.com', 'Logistics', 'Dubai', 'UAE', '1200000.00'),
    mkCompany('Delta Foods', 'deltafoods.com', 'FMCG', 'Alexandria', 'Egypt', '800000.00'),
    mkCompany('Levant Media', 'levantmedia.tv', 'Media', 'Amman', 'Jordan', '150000.00'),
    mkCompany('Atlas Construction', 'atlasbuild.co', 'Construction', 'Riyadh', 'Saudi Arabia', '4200000.00'),
  ];

  const mkContact = (
    first: string, last: string, email: string, title: string, company: DCompany | null,
    source: string, tags: number[] = [],
  ): DContact => {
    const contact: DContact = {
      id: nextId(database), organization: org.id, first_name: first, last_name: last, email,
      phone: '+20 100 555 0100', job_title: title, company: company?.id ?? null, owner: owner.id,
      source, address: '', city: company?.city ?? '', country: company?.country ?? '',
      description: '', is_active: true, tags, created_at: daysAgo(80), updated_at: now,
    };
    database.contacts.push(contact);
    return contact;
  };
  const contacts = [
    mkContact('Omar', 'Khaled', 'omar@nilesoft.io', 'CTO', companies[0], 'website', [tagVip.id]),
    mkContact('Sara', 'Mansour', 'sara@nilesoft.io', 'Procurement Lead', companies[0], 'referral'),
    mkContact('Ahmed', 'Al-Rashid', 'ahmed@gulflog.com', 'Operations Director', companies[1], 'event'),
    mkContact('Mona', 'Ibrahim', 'mona@deltafoods.com', 'CEO', companies[2], 'cold_call', [tagVip.id, tagPartner.id]),
    mkContact('Karim', 'Haddad', 'karim@levantmedia.tv', 'Head of Partnerships', companies[3], 'social'),
    mkContact('Fatima', 'Al-Otaibi', 'fatima@atlasbuild.co', 'CFO', companies[4], 'referral'),
    mkContact('John', 'Peterson', 'john@freelance.dev', 'Consultant', null, 'website'),
  ];

  const mkLead = (
    first: string, last: string, email: string, companyName: string, status: string,
    score: number, value: string | null,
  ) => {
    database.leads.push({
      id: nextId(database), organization: org.id, first_name: first, last_name: last, email,
      phone: '', company_name: companyName, job_title: '', source: 'website', status, score,
      estimated_value: value, owner: score > 50 ? teammate.id : owner.id, description: '',
      converted_at: null, converted_contact: null, converted_deal: null,
      created_at: daysAgo(12), updated_at: now,
    });
  };
  mkLead('Nadia', 'Fares', 'nadia@horizonbank.com', 'Horizon Bank', 'new', 35, '45000.00');
  mkLead('Tarek', 'Salem', 'tarek@medicaplus.com', 'Medica Plus', 'contacted', 55, '18000.00');
  mkLead('Lina', 'Aziz', 'lina@stellartravel.co', 'Stellar Travel', 'qualified', 80, '32000.00');
  mkLead('Hassan', 'Nouri', 'hassan@oasisretail.com', 'Oasis Retail', 'new', 20, '9000.00');
  mkLead('Emily', 'Carter', 'emily@brightedu.org', 'Bright Education', 'unqualified', 10, null);

  const mkDeal = (
    title: string, value: string, stageIndex: number, status: 'open' | 'won' | 'lost',
    contact: DContact, company: DCompany, index: number,
  ) => {
    const closed = status !== 'open';
    database.deals.push({
      id: nextId(database), organization: org.id, title, value, currency: org.currency,
      pipeline: pipelineId, stage: stages[stageIndex].id, contact: contact.id, company: company.id,
      owner: index % 2 ? teammate.id : owner.id, status,
      expected_close_date: dateAhead(14 + index * 9),
      closed_at: closed ? daysAgo(20 + index * 12) : null,
      lost_reason: status === 'lost' ? 'Chose a competitor' : '',
      description: '', tags: [], created_at: daysAgo(60 - index * 5), updated_at: now,
    });
  };
  mkDeal('ERP implementation — Nile Software', '85000.00', 0, 'open', contacts[0], companies[0], 0);
  mkDeal('Fleet tracking rollout', '120000.00', 1, 'open', contacts[2], companies[1], 1);
  mkDeal('Annual supply contract', '64000.00', 2, 'open', contacts[3], companies[2], 2);
  mkDeal('Media production retainer', '36000.00', 3, 'open', contacts[4], companies[3], 3);
  mkDeal('HQ tower consultancy', '210000.00', 4, 'open', contacts[5], companies[4], 4);
  mkDeal('Website revamp', '15000.00', 2, 'won', contacts[1], companies[0], 5);
  mkDeal('Warehouse automation pilot', '48000.00', 3, 'won', contacts[2], companies[1], 6);
  mkDeal('Catering software license', '22000.00', 1, 'lost', contacts[3], companies[2], 7);
  // Spread the won deals across recent months so the revenue chart has shape.
  const won = database.deals.filter((d) => d.status === 'won');
  won.forEach((deal, index) => {
    deal.closed_at = daysAgo(20 + index * 40);
  });

  const mkActivity = (
    type: DActivity['type'], title: string, contact: DContact | null, dayOffset: number, completed: boolean,
  ) => {
    database.activities.push({
      id: nextId(database), organization: org.id, type, title, description: '',
      due_at: dayOffset >= 0 ? daysAhead(dayOffset) : daysAgo(-dayOffset), completed,
      completed_at: completed ? daysAgo(1) : null, assigned_to: owner.id,
      contact: contact?.id ?? null, company: null, deal: null, lead: null,
      created_at: daysAgo(10), updated_at: now,
    });
  };
  mkActivity('call', 'Discovery call with Omar', contacts[0], 1, false);
  mkActivity('meeting', 'Demo for Gulf Logistics ops team', contacts[2], 3, false);
  mkActivity('task', 'Send proposal to Delta Foods', contacts[3], 2, false);
  mkActivity('email', 'Follow up on retainer terms', contacts[4], -2, false);
  mkActivity('task', 'Prepare Q3 pipeline review', null, 5, false);
  mkActivity('call', 'Intro call with Fatima', contacts[5], -6, true);

  database.notes.push(
    {
      id: nextId(database), organization: org.id, author: owner.id,
      body: 'Omar prefers technical deep-dives — bring an engineer to the next call.',
      contact: contacts[0].id, company: null, deal: null, lead: null,
      created_at: daysAgo(9), updated_at: daysAgo(9),
    },
    {
      id: nextId(database), organization: org.id, author: teammate.id,
      body: 'Budget approval expected after their board meeting.',
      contact: contacts[3].id, company: null, deal: null, lead: null,
      created_at: daysAgo(7), updated_at: daysAgo(7),
    },
  );

  const mkDept = (name: string): DDepartment => {
    const department: DDepartment = {
      id: nextId(database), organization: org.id, name, description: '',
      created_at: daysAgo(100), updated_at: now,
    };
    database.departments.push(department);
    return department;
  };
  const deptSales = mkDept('Sales');
  const deptEng = mkDept('Engineering');
  const deptSupport = mkDept('Customer Support');

  const mkEmployee = (
    first: string, last: string, dept: DDepartment, title: string, status: string,
    salary: string, manager: number | null = null, user: number | null = null,
  ): DEmployee => {
    const employee: DEmployee = {
      id: nextId(database), organization: org.id, first_name: first, last_name: last,
      email: `${first.toLowerCase()}@acmetrading.com`, phone: '', user,
      department: dept.id, job_title: title, employment_type: 'full_time', status,
      hire_date: daysAgo(400).slice(0, 10), salary, manager, city: 'Cairo', country: 'Egypt',
      created_at: daysAgo(90), updated_at: now,
    };
    database.employees.push(employee);
    return employee;
  };
  const manager = mkEmployee('Layla', 'Hassan', deptSales, 'Sales Manager', 'active', '4500.00', null, teammate.id);
  manager.email = 'sales@crm.com';
  mkEmployee('Youssef', 'Adel', deptSales, 'Account Executive', 'active', '2600.00', manager.id);
  mkEmployee('Rana', 'Mostafa', deptSales, 'SDR', 'active', '1800.00', manager.id);
  mkEmployee('Amr', 'Fathy', deptEng, 'Backend Engineer', 'active', '3800.00');
  mkEmployee('Dina', 'Sami', deptEng, 'Frontend Engineer', 'on_leave', '3600.00');
  mkEmployee('Khaled', 'Omar', deptSupport, 'Support Specialist', 'active', '1600.00');

  const mkTicket = (
    subject: string, description: string, contact: DContact, status: string,
    priority: string, category: string, assigned: number,
  ): DTicket => {
    const ticket: DTicket = {
      id: nextId(database), organization: org.id,
      number: database.tickets.filter((x) => x.organization === org.id).length + 1,
      subject, description, contact: contact.id, status, priority, category,
      assigned_to: assigned, created_at: daysAgo(6), updated_at: now,
    };
    database.tickets.push(ticket);
    return ticket;
  };
  const ticket1 = mkTicket(
    'Cannot export contacts to CSV', 'Export button returns a 500 error since yesterday.',
    contacts[0], 'open', 'high', 'technical', owner.id,
  );
  mkTicket(
    'Invoice for August is missing', 'We did not receive the August invoice by email.',
    contacts[3], 'in_progress', 'medium', 'billing', teammate.id,
  );
  mkTicket(
    'Feature request: WhatsApp integration', 'Sales team would like to log WhatsApp conversations.',
    contacts[2], 'resolved', 'low', 'feature_request', owner.id,
  );
  database.ticketComments.push(
    {
      id: nextId(database), ticket: ticket1.id, author: owner.id,
      body: 'Reproduced — escalating to engineering.', is_internal: false,
      created_at: daysAgo(5), updated_at: daysAgo(5),
    },
    {
      id: nextId(database), ticket: ticket1.id, author: teammate.id,
      body: 'Fix scheduled for the next release.', is_internal: true,
      created_at: daysAgo(4), updated_at: daysAgo(4),
    },
  );

  return database;
}

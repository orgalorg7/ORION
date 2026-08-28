// ---------------------------------------------------------------------------
// Shared API types — these mirror the Django REST API contract exactly.
// ---------------------------------------------------------------------------

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface UserBrief {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
}

export interface User extends UserBrief {
  phone: string;
  language: 'en' | 'ar';
  date_joined: string;
}

export type Role = 'owner' | 'admin' | 'manager' | 'member';

export interface Organization {
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

export interface MembershipBrief {
  id: number;
  role: Role;
  is_active: boolean;
  organization: Organization;
}

export interface Membership {
  id: number;
  role: Role;
  is_active: boolean;
  user: UserBrief;
  created_at: string;
}

export interface Plan {
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

export interface Subscription {
  id: number;
  plan: Plan;
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  trial_end: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface Invitation {
  id: number;
  email: string;
  role: Role;
  invited_by: UserBrief | null;
  accepted_at: string | null;
  created_at: string;
}

// --- CRM -------------------------------------------------------------------

export type LeadSource =
  | 'website'
  | 'referral'
  | 'social'
  | 'email_campaign'
  | 'event'
  | 'cold_call'
  | 'other'
  | '';

export interface Tag {
  id: number;
  name: string;
  color: string;
  created_at: string;
}

export interface CompanyBrief {
  id: number;
  name: string;
}

export interface Company {
  id: number;
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
  owner_detail: UserBrief | null;
  tags: number[];
  tags_detail: Tag[];
  contacts_count: number;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  job_title: string;
  company: number | null;
  company_detail: CompanyBrief | null;
  owner: number | null;
  owner_detail: UserBrief | null;
  source: LeadSource;
  address: string;
  city: string;
  country: string;
  description: string;
  is_active: boolean;
  tags: number[];
  tags_detail: Tag[];
  created_at: string;
  updated_at: string;
}

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'unqualified' | 'converted';

export interface Lead {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company_name: string;
  job_title: string;
  source: LeadSource;
  status: LeadStatus;
  score: number;
  estimated_value: string | null;
  owner: number | null;
  owner_detail: UserBrief | null;
  description: string;
  converted_at: string | null;
  converted_contact: number | null;
  converted_deal: number | null;
  created_at: string;
  updated_at: string;
}

export interface Stage {
  id: number;
  pipeline: number;
  name: string;
  order: number;
  probability: number;
  color: string;
}

export interface Pipeline {
  id: number;
  name: string;
  is_default: boolean;
  stages: Stage[];
}

export type DealStatus = 'open' | 'won' | 'lost';

export interface Deal {
  id: number;
  title: string;
  value: string;
  currency: string;
  pipeline: number;
  stage: number | null;
  stage_detail: Stage | null;
  contact: number | null;
  contact_detail: { id: number; first_name: string; last_name: string } | null;
  company: number | null;
  company_detail: CompanyBrief | null;
  owner: number | null;
  owner_detail: UserBrief | null;
  status: DealStatus;
  expected_close_date: string | null;
  closed_at: string | null;
  lost_reason: string;
  description: string;
  tags: number[];
  tags_detail: Tag[];
  created_at: string;
  updated_at: string;
}

export type ActivityType = 'call' | 'email' | 'meeting' | 'task';

export interface Activity {
  id: number;
  type: ActivityType;
  title: string;
  description: string;
  due_at: string | null;
  completed: boolean;
  completed_at: string | null;
  assigned_to: number | null;
  assigned_to_detail: UserBrief | null;
  contact: number | null;
  contact_detail: { id: number; first_name: string; last_name: string } | null;
  company: number | null;
  company_detail: CompanyBrief | null;
  deal: number | null;
  deal_detail: { id: number; title: string } | null;
  lead: number | null;
  lead_detail: { id: number; first_name: string; last_name: string } | null;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: number;
  body: string;
  author: number | null;
  author_detail: UserBrief | null;
  contact: number | null;
  company: number | null;
  deal: number | null;
  lead: number | null;
  created_at: string;
  updated_at: string;
}

// --- HR ----------------------------------------------------------------------

export interface Department {
  id: number;
  name: string;
  description: string;
  employees_count: number;
  created_at: string;
}

export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'intern';
export type EmployeeStatus = 'active' | 'on_leave' | 'terminated';

export interface Employee {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  user: number | null;
  user_detail: UserBrief | null;
  department: number | null;
  department_detail: { id: number; name: string } | null;
  job_title: string;
  employment_type: EmploymentType;
  status: EmployeeStatus;
  hire_date: string | null;
  salary: string | null;
  manager: number | null;
  manager_detail: { id: number; first_name: string; last_name: string } | null;
  city: string;
  country: string;
  created_at: string;
  updated_at: string;
}

// --- Support -----------------------------------------------------------------

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TicketCategory = 'general' | 'billing' | 'technical' | 'feature_request';

export interface Ticket {
  id: number;
  number: number;
  subject: string;
  description: string;
  contact: number | null;
  contact_detail: { id: number; first_name: string; last_name: string } | null;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  assigned_to: number | null;
  assigned_to_detail: UserBrief | null;
  comments_count: number;
  created_at: string;
  updated_at: string;
}

export interface TicketComment {
  id: number;
  author: number | null;
  author_detail: UserBrief | null;
  body: string;
  is_internal: boolean;
  created_at: string;
}

// --- Analytics ---------------------------------------------------------------

export interface DashboardActivityItem {
  id: number;
  type: ActivityType;
  title: string;
  due_at: string | null;
  completed: boolean;
  created_at: string;
}

export interface DashboardDealItem {
  id: number;
  title: string;
  value: number;
  currency: string;
  stage_name: string;
  company_name: string;
}

export interface DashboardData {
  totals: {
    contacts: number;
    companies: number;
    open_deals: number;
    open_deals_value: number;
    won_deals_this_month: number;
    won_value_this_month: number;
    new_leads_this_month: number;
    open_tickets: number;
    active_employees: number;
  };
  deals_by_stage: { stage_id: number; stage_name: string; color: string; count: number; value: number }[];
  revenue_by_month: { month: string; value: number; count: number }[];
  leads_by_source: { source: string; count: number }[];
  leads_by_status: { status: string; count: number }[];
  recent_activities: DashboardActivityItem[];
  upcoming_activities: DashboardActivityItem[];
  top_deals: DashboardDealItem[];
}

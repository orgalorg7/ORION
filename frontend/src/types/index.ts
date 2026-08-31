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

export type LeadSource = string;

export interface LeadSourceConfig {
  id: number;
  key: string;
  system_key: string;
  label: string;
  active: boolean;
  display_order: number;
}

export interface TeamBrief { id: number; name: string }
export type CustomFieldValues = Record<string, unknown>;

export interface Tag {
  id: number;
  name: string;
  color: string;
  created_at: string;
  archived_at: string | null;
}

export interface CompanyBrief {
  id: number;
  name: string;
  domain: string;
}

export interface Company {
  id: number;
  name: string;
  normalized_name: string;
  legal_name: string;
  domain: string;
  normalized_domain: string;
  industry: string;
  size: string;
  website: string;
  email: string;
  phone: string;
  primary_phone: string;
  normalized_phone: string;
  normalized_email: string;
  address: string;
  city: string;
  country: string;
  annual_revenue: string | null;
  employee_count: number | null;
  currency: string;
  lifecycle_stage: string;
  source: string;
  source_record: number | null;
  source_detail: LeadSourceConfig | null;
  description: string;
  owner: number | null;
  owner_detail: UserBrief | null;
  team: number | null;
  team_detail: TeamBrief | null;
  tags: number[];
  tags_detail: Tag[];
  contacts_count: number;
  custom_fields: CustomFieldValues;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string | null;
  next_activity_at: string | null;
  next_activity_id: number | null;
  next_activity_title: string | null;
  next_activity_type: ActivityType | null;
  next_activity_due_date: string | null;
  next_activity_all_day: boolean | null;
}

export interface Contact {
  id: number;
  first_name: string;
  last_name: string;
  display_name: string;
  normalized_name: string;
  email: string;
  primary_email: string;
  normalized_email: string;
  phone: string;
  primary_phone: string;
  normalized_phone: string;
  secondary_phone: string;
  job_title: string;
  department: string;
  company: number | null;
  company_detail: CompanyBrief | null;
  owner: number | null;
  owner_detail: UserBrief | null;
  team: number | null;
  team_detail: TeamBrief | null;
  source: LeadSource;
  source_record: number | null;
  source_detail: LeadSourceConfig | null;
  lifecycle_stage: string;
  preferred_channel: string;
  language: string;
  timezone: string;
  address: string;
  city: string;
  country: string;
  description: string;
  is_active: boolean;
  tags: number[];
  tags_detail: Tag[];
  custom_fields: CustomFieldValues;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string | null;
  next_activity_at: string | null;
  next_activity_id: number | null;
  next_activity_title: string | null;
  next_activity_type: ActivityType | null;
  next_activity_due_date: string | null;
  next_activity_all_day: boolean | null;
}

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'unqualified' | 'converted';

export interface Lead {
  id: number;
  first_name: string;
  last_name: string;
  display_name: string;
  normalized_name: string;
  email: string;
  normalized_email: string;
  phone: string;
  normalized_phone: string;
  secondary_phone: string;
  company_name: string;
  company: number | null;
  company_detail: CompanyBrief | null;
  job_title: string;
  source: LeadSource;
  source_record: number | null;
  source_detail: LeadSourceConfig | null;
  lifecycle_stage: string;
  status: LeadStatus;
  score: number;
  score_breakdown: Array<{ rule: string; points: number }>;
  temperature: 'cold' | 'warm' | 'hot' | '';
  estimated_value: string | null;
  currency: string;
  owner: number | null;
  owner_detail: UserBrief | null;
  team: number | null;
  team_detail: TeamBrief | null;
  country: string;
  city: string;
  address: string;
  timezone: string;
  language: string;
  preferred_channel: string;
  description: string;
  converted_at: string | null;
  converted_contact: number | null;
  converted_company: number | null;
  converted_deal: number | null;
  tags: number[];
  tags_detail: Tag[];
  custom_fields: CustomFieldValues;
  archived_at: string | null;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
  created_at: string;
  updated_at: string;
  last_activity_at: string | null;
  next_activity_at: string | null;
  next_activity_id: number | null;
  next_activity_title: string | null;
  next_activity_type: ActivityType | null;
  next_activity_due_date: string | null;
  next_activity_all_day: boolean | null;
}

export interface Stage {
  id: number;
  pipeline: number;
  name: string;
  description: string;
  order: number;
  probability: number;
  stage_type: 'open' | 'won' | 'lost' | 'on_hold';
  color: string;
  active: boolean;
  archived_at: string | null;
  deals_count: number;
  created_at: string;
  updated_at: string;
}

export interface Pipeline {
  id: number;
  name: string;
  key: string;
  description: string;
  is_default: boolean;
  active: boolean;
  display_order: number;
  require_lost_reason: boolean;
  stale_activity_days: number;
  stale_stage_days: number;
  version: number;
  archived_at: string | null;
  stages: Stage[];
  created_at: string;
  updated_at: string;
}

export type DealStatus = 'open' | 'won' | 'lost' | 'abandoned';
export type DealPriority = 'low' | 'medium' | 'high' | 'critical';

export interface LostReason {
  id: number;
  label: string;
  active: boolean;
  display_order: number;
  archived_at: string | null;
}

export interface Product {
  id: number;
  name: string;
  sku: string;
  description: string;
  active: boolean;
  default_price: string;
  currency: string;
  archived_at: string | null;
}

export interface DealLineItem {
  id: number;
  product: number | null;
  product_detail: Product | null;
  name_snapshot: string;
  sku_snapshot: string;
  quantity: string;
  unit_price: string;
  discount_type: 'none' | 'fixed' | 'percent';
  discount_value: string;
  tax_rate: string;
  line_total: string;
  position: number;
}

export interface DealParticipant {
  id: number;
  contact: number;
  contact_detail: { id: number; first_name: string; last_name: string; display_name: string; email: string };
  role: 'primary' | 'decision_maker' | 'champion' | 'influencer' | 'billing' | 'technical' | 'other';
  is_primary: boolean;
}

export interface Deal {
  id: number;
  title: string;
  normalized_title: string;
  value: string;
  amount: string;
  value_mode: 'manual' | 'line_items';
  currency: string;
  probability_override: number | null;
  probability: number;
  weighted_value: string;
  pipeline: number;
  pipeline_detail: Pipeline;
  stage: number;
  stage_detail: Stage;
  contact: number | null;
  contact_detail: { id: number; first_name: string; last_name: string; display_name: string; email: string } | null;
  company: number | null;
  company_detail: CompanyBrief | null;
  owner: number | null;
  owner_detail: UserBrief | null;
  team: number | null;
  team_detail: TeamBrief | null;
  status: DealStatus;
  priority: DealPriority;
  source: string;
  deal_type: string;
  forecast_category: 'pipeline' | 'best_case' | 'commit' | 'closed';
  expected_close_date: string | null;
  actual_close_date: string | null;
  closed_at: string | null;
  won_at: string | null;
  lost_at: string | null;
  abandoned_at: string | null;
  reopened_at: string | null;
  lost_reason: string;
  lost_reason_record: number | null;
  lost_reason_detail: LostReason | null;
  lost_reason_text: string;
  description: string;
  stage_entered_at: string;
  version: number;
  archived_at: string | null;
  tags: number[];
  tags_detail: Tag[];
  participants: DealParticipant[];
  participants_count: number;
  line_items: DealLineItem[];
  line_items_count: number;
  custom_fields: CustomFieldValues;
  age_days: number;
  stage_age_days: number;
  days_until_close: number | null;
  overdue_days: number;
  is_stale: boolean;
  stale_reasons: string[];
  created_at: string;
  updated_at: string;
  last_activity_at: string | null;
  next_activity_at: string | null;
  next_activity_id: number | null;
  next_activity_title: string | null;
  next_activity_type: ActivityType | null;
  next_activity_due_date: string | null;
  next_activity_all_day: boolean | null;
}

export type ActivityType = 'task' | 'call' | 'meeting' | 'follow_up' | 'reminder' | 'email';
export type ActivityStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';
export type ActivityPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface ActivityReminder {
  id: number;
  recipient: number;
  channel: 'in_app' | 'email' | 'push' | 'whatsapp';
  scheduled_for: string;
  offset_minutes: number | null;
  status: 'scheduled' | 'processing' | 'sent' | 'failed' | 'cancelled';
}

export interface ActivityAttendee {
  id: number;
  user: number | null;
  user_detail: UserBrief | null;
  contact: number | null;
  contact_detail: { id: number; first_name: string; last_name: string; email: string; phone: string } | null;
  external_email: string;
  display_name: string;
  response_status: string;
}

export interface ActivityOutcomeDefinition {
  id: number;
  key: string;
  label: string;
  category: 'call' | 'meeting' | 'general';
  active: boolean;
  display_order: number;
}

export interface ActivityHistory {
  id: number;
  event_type: string;
  actor: number | null;
  actor_detail: UserBrief | null;
  occurred_at: string;
  changes: Record<string, unknown>;
}

export interface Activity {
  id: number;
  type: ActivityType;
  subtype: string;
  status: ActivityStatus;
  priority: ActivityPriority;
  title: string;
  description: string;
  outcome: string;
  outcome_key_snapshot: string;
  outcome_label_snapshot: string;
  internal_notes: string;
  due_at: string | null;
  due_date: string | null;
  all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
  scheduled_timezone: string;
  completed: boolean;
  completed_at: string | null;
  cancelled_at: string | null;
  snoozed_until: string | null;
  assigned_to: number | null;
  assigned_to_detail: UserBrief | null;
  owner: number | null;
  owner_detail: UserBrief | null;
  team: number | null;
  team_detail: TeamBrief | null;
  contact: number | null;
  contact_detail: { id: number; first_name: string; last_name: string } | null;
  company: number | null;
  company_detail: CompanyBrief | null;
  deal: number | null;
  deal_detail: { id: number; title: string } | null;
  lead: number | null;
  lead_detail: { id: number; first_name: string; last_name: string } | null;
  attendees: ActivityAttendee[];
  reminders: ActivityReminder[];
  recurrence_rule: string;
  recurring_series: number | null;
  occurrence_start: string | null;
  call_direction: 'inbound' | 'outbound' | '';
  call_duration_seconds: number | null;
  phone_number: string;
  location: string;
  meeting_url: string;
  sla_deadline_at: string | null;
  is_overdue: boolean;
  overdue_by_seconds: number;
  version: number;
  archived_at: string | null;
  custom_fields: CustomFieldValues;
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
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DuplicateCandidate {
  candidate_id: number;
  candidate_type: 'lead' | 'contact' | 'company';
  display_name: string;
  confidence_score: number;
  match_reasons: string[];
}

export interface DomainEvent {
  id: number;
  actor: number | null;
  actor_detail: UserBrief | null;
  object_type: string;
  object_id: number;
  event_type: string;
  metadata: Record<string, unknown>;
  field_diff: Record<string, unknown>;
  created_at: string;
}

export interface ImportJob {
  id: number;
  target_object: 'lead' | 'contact' | 'company' | 'deal' | 'activity';
  original_filename: string;
  status: 'uploaded' | 'validated' | 'processing' | 'completed' | 'failed';
  detected_columns: string[];
  preview_rows: Array<Record<string, string>>;
  mapping: Record<string, string>;
  report: {
    total?: number; successful?: number; failed?: number; skipped?: number; duplicate_candidates?: number;
    errors?: Array<{
      row_number: number;
      field: string | null;
      reason: unknown;
      raw_value: Record<string, string>;
    }>;
  };
  created_at: string;
  updated_at: string;
}

export interface CustomFieldDefinition {
  id: number;
  target_object: 'lead' | 'contact' | 'company' | 'deal' | 'activity';
  key: string;
  label: string;
  data_type: string;
  description: string;
  required: boolean;
  options: Array<string | { value: string; label?: string }>;
  display_order: number;
  active: boolean;
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

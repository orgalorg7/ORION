import { lazy, Suspense } from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';

import { IS_DEMO } from '@/lib/api';

import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Spinner, Toaster } from '@/components/ui';
import { AuthLayout } from '@/layouts/AuthLayout';
import { DashboardLayout } from '@/layouts/DashboardLayout';

const ActivitiesPage = lazy(() => import('@/features/activities/ActivitiesPage').then((module) => ({ default: module.ActivitiesPage })));
const LoginPage = lazy(() => import('@/features/auth/LoginPage').then((module) => ({ default: module.LoginPage })));
const RegisterPage = lazy(() => import('@/features/auth/RegisterPage').then((module) => ({ default: module.RegisterPage })));
const CompaniesPage = lazy(() => import('@/features/companies/CompaniesPage').then((module) => ({ default: module.CompaniesPage })));
const CompanyDetailPage = lazy(() => import('@/features/companies/CompanyDetailPage').then((module) => ({ default: module.CompanyDetailPage })));
const ContactsPage = lazy(() => import('@/features/contacts/ContactsPage').then((module) => ({ default: module.ContactsPage })));
const ContactDetailPage = lazy(() => import('@/features/contacts/ContactDetailPage').then((module) => ({ default: module.ContactDetailPage })));
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const DealsPage = lazy(() => import('@/features/deals/DealsPage').then((module) => ({ default: module.DealsPage })));
const DealDetailPage = lazy(() => import('@/features/deals/DealDetailPage').then((module) => ({ default: module.DealDetailPage })));
const EmployeesPage = lazy(() => import('@/features/employees/EmployeesPage').then((module) => ({ default: module.EmployeesPage })));
const EmployeeDetailPage = lazy(() => import('@/features/employees/EmployeeDetailPage').then((module) => ({ default: module.EmployeeDetailPage })));
const LeadsPage = lazy(() => import('@/features/leads/LeadsPage').then((module) => ({ default: module.LeadsPage })));
const LeadDetailPage = lazy(() => import('@/features/leads/LeadDetailPage').then((module) => ({ default: module.LeadDetailPage })));
const BillingSettings = lazy(() => import('@/features/settings/BillingSettings').then((module) => ({ default: module.BillingSettings })));
const OrganizationSettings = lazy(() => import('@/features/settings/OrganizationSettings').then((module) => ({ default: module.OrganizationSettings })));
const PipelineSettings = lazy(() => import('@/features/settings/PipelineSettings').then((module) => ({ default: module.PipelineSettings })));
const ProfileSettings = lazy(() => import('@/features/settings/ProfileSettings').then((module) => ({ default: module.ProfileSettings })));
const SettingsLayout = lazy(() => import('@/features/settings/SettingsLayout').then((module) => ({ default: module.SettingsLayout })));
const TagSettings = lazy(() => import('@/features/settings/TagSettings').then((module) => ({ default: module.TagSettings })));
const TeamSettings = lazy(() => import('@/features/settings/TeamSettings').then((module) => ({ default: module.TeamSettings })));
const TicketsPage = lazy(() => import('@/features/tickets/TicketsPage').then((module) => ({ default: module.TicketsPage })));
const TicketDetailPage = lazy(() => import('@/features/tickets/TicketDetailPage').then((module) => ({ default: module.TicketDetailPage })));

// Artifact hosting serves a single page, so demo builds use hash-based routing.
const Router = IS_DEMO ? HashRouter : BrowserRouter;

export default function App() {
  return (
    <Router>
      <Toaster />
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading page"><Spinner className="h-8 w-8 text-primary-600" /></div>}>
      <Routes>
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route path="/app" element={<DashboardLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="leads" element={<LeadsPage />} />
            <Route path="leads/:id" element={<LeadDetailPage />} />
            <Route path="contacts" element={<ContactsPage />} />
            <Route path="contacts/:id" element={<ContactDetailPage />} />
            <Route path="companies" element={<CompaniesPage />} />
            <Route path="companies/:id" element={<CompanyDetailPage />} />
            <Route path="deals" element={<DealsPage />} />
            <Route path="deals/:id" element={<DealDetailPage />} />
            <Route path="activities" element={<ActivitiesPage />} />
            <Route path="tickets" element={<TicketsPage />} />
            <Route path="tickets/:id" element={<TicketDetailPage />} />
            <Route path="employees" element={<EmployeesPage />} />
            <Route path="employees/:id" element={<EmployeeDetailPage />} />
            <Route path="settings" element={<SettingsLayout />}>
              <Route index element={<ProfileSettings />} />
              <Route path="organization" element={<OrganizationSettings />} />
              <Route path="team" element={<TeamSettings />} />
              <Route path="pipelines" element={<PipelineSettings />} />
              <Route path="tags" element={<TagSettings />} />
              <Route path="billing" element={<BillingSettings />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
      </Suspense>
    </Router>
  );
}

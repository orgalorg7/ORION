import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';

import { IS_DEMO } from '@/lib/api';

import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Toaster } from '@/components/ui';
import { ActivitiesPage } from '@/features/activities/ActivitiesPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { CompaniesPage } from '@/features/companies/CompaniesPage';
import { CompanyDetailPage } from '@/features/companies/CompanyDetailPage';
import { ContactDetailPage } from '@/features/contacts/ContactDetailPage';
import { ContactsPage } from '@/features/contacts/ContactsPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { DealDetailPage } from '@/features/deals/DealDetailPage';
import { DealsPage } from '@/features/deals/DealsPage';
import { EmployeeDetailPage } from '@/features/employees/EmployeeDetailPage';
import { EmployeesPage } from '@/features/employees/EmployeesPage';
import { LeadDetailPage } from '@/features/leads/LeadDetailPage';
import { LeadsPage } from '@/features/leads/LeadsPage';
import { BillingSettings } from '@/features/settings/BillingSettings';
import { OrganizationSettings } from '@/features/settings/OrganizationSettings';
import { PipelineSettings } from '@/features/settings/PipelineSettings';
import { ProfileSettings } from '@/features/settings/ProfileSettings';
import { SettingsLayout } from '@/features/settings/SettingsLayout';
import { TagSettings } from '@/features/settings/TagSettings';
import { TeamSettings } from '@/features/settings/TeamSettings';
import { TicketDetailPage } from '@/features/tickets/TicketDetailPage';
import { TicketsPage } from '@/features/tickets/TicketsPage';
import { AuthLayout } from '@/layouts/AuthLayout';
import { DashboardLayout } from '@/layouts/DashboardLayout';

// Artifact hosting serves a single page, so demo builds use hash-based routing.
const Router = IS_DEMO ? HashRouter : BrowserRouter;

export default function App() {
  return (
    <Router>
      <Toaster />
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
    </Router>
  );
}

from datetime import timedelta
from decimal import Decimal

from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.activities.models import Activity
from apps.contacts.models import Company, Contact
from apps.deals.models import Deal, Pipeline, Stage
from apps.hr.models import Employee
from apps.leads.models import Lead
from apps.organizations.services import register_account
from apps.support.models import Ticket

DASHBOARD_URL = '/api/v1/analytics/dashboard/'

DASHBOARD_KEYS = [
    'totals', 'deals_by_stage', 'revenue_by_month', 'leads_by_source',
    'leads_by_status', 'recent_activities', 'upcoming_activities', 'top_deals',
]


class DashboardApiTests(APITestCase):
    def setUp(self):
        self.user_a, self.org_a = register_account(
            email='a@example.com', password='StrongPass123!', first_name='Alice', organization_name='Org A'
        )
        self.user_b, self.org_b = register_account(
            email='b@example.com', password='StrongPass123!', first_name='Bob', organization_name='Org B'
        )

    def _seed_org_a(self):
        company = Company.objects.create(organization=self.org_a, name='Acme', created_by=self.user_a)
        Contact.objects.create(
            organization=self.org_a, first_name='Sara', company=company, created_by=self.user_a
        )
        Lead.objects.create(organization=self.org_a, first_name='Lina', source='website', created_by=self.user_a)
        Lead.objects.create(
            organization=self.org_a, first_name='Omar', source='',
            status=Lead.Status.CONTACTED, created_by=self.user_a,
        )
        pipeline = Pipeline.objects.get(organization=self.org_a, is_default=True)
        stage = pipeline.stages.get(name='Qualified')
        won_stage = pipeline.stages.get(stage_type=Stage.Type.WON)
        Deal.objects.create(
            organization=self.org_a, title='Big deal', value=Decimal('1000.00'),
            pipeline=pipeline, stage=stage, company=company, created_by=self.user_a,
        )
        Deal.objects.create(
            organization=self.org_a, title='Won deal', value=Decimal('500.00'),
            pipeline=pipeline, stage=won_stage, status=Deal.Status.WON,
            closed_at=timezone.now(), created_by=self.user_a,
        )
        Activity.objects.create(
            organization=self.org_a, type=Activity.Type.CALL, title='Call Sara', created_by=self.user_a
        )
        Activity.objects.create(
            organization=self.org_a, title='Follow up',
            due_at=timezone.now() + timedelta(days=1), created_by=self.user_a,
        )
        Employee.objects.create(organization=self.org_a, first_name='Hana', created_by=self.user_a)
        Ticket.objects.create(organization=self.org_a, subject='Login issue', created_by=self.user_a)
        return pipeline, stage

    def test_dashboard_totals_and_shape(self):
        pipeline, stage = self._seed_org_a()
        self.client.force_authenticate(self.user_a)
        response = self.client.get(DASHBOARD_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        for key in DASHBOARD_KEYS:
            self.assertIn(key, response.data)

        totals = response.data['totals']
        self.assertEqual(totals['contacts'], 1)
        self.assertEqual(totals['companies'], 1)
        self.assertEqual(totals['open_deals'], 1)
        self.assertEqual(totals['open_deals_value'], 1000.0)
        self.assertEqual(totals['won_deals_this_month'], 1)
        self.assertEqual(totals['won_value_this_month'], 500.0)
        self.assertEqual(totals['new_leads_this_month'], 2)
        self.assertEqual(totals['open_tickets'], 1)
        self.assertEqual(totals['active_employees'], 1)

    def test_dashboard_revenue_by_month(self):
        self._seed_org_a()
        self.client.force_authenticate(self.user_a)
        response = self.client.get(DASHBOARD_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

        revenue = response.data['revenue_by_month']
        self.assertEqual(len(revenue), 6)
        current = timezone.now().strftime('%Y-%m')
        self.assertEqual(revenue[-1]['month'], current)
        self.assertEqual(revenue[-1]['value'], 500.0)
        self.assertEqual(revenue[-1]['count'], 1)
        for entry in revenue[:-1]:
            self.assertEqual(entry['value'], 0.0)
            self.assertEqual(entry['count'], 0)

    def test_dashboard_deals_by_stage_and_top_deals(self):
        pipeline, stage = self._seed_org_a()
        self.client.force_authenticate(self.user_a)
        response = self.client.get(DASHBOARD_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

        by_stage = response.data['deals_by_stage']
        self.assertEqual(len(by_stage), pipeline.stages.count())
        qualified = next(item for item in by_stage if item['stage_id'] == stage.id)
        self.assertEqual(qualified['stage_name'], 'Qualified')
        self.assertEqual(qualified['color'], stage.color)
        self.assertEqual(qualified['count'], 1)
        self.assertEqual(qualified['value'], 1000.0)

        top = response.data['top_deals']
        self.assertEqual(len(top), 1)
        self.assertEqual(top[0]['title'], 'Big deal')
        self.assertEqual(top[0]['value'], 1000.0)
        self.assertEqual(top[0]['currency'], 'USD')
        self.assertEqual(top[0]['stage_name'], 'Qualified')
        self.assertEqual(top[0]['company_name'], 'Acme')

    def test_dashboard_pipeline_query_param(self):
        self._seed_org_a()
        other_pipeline = Pipeline.objects.create(organization=self.org_a, name='Renewals')
        other_stage = Stage.objects.create(
            organization=self.org_a, pipeline=other_pipeline, name='Kickoff', order=0
        )
        Deal.objects.create(
            organization=self.org_a, title='Renewal deal', value=Decimal('250.00'),
            pipeline=other_pipeline, stage=other_stage, created_by=self.user_a,
        )
        self.client.force_authenticate(self.user_a)
        response = self.client.get(DASHBOARD_URL, {'pipeline': other_pipeline.id})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

        by_stage = response.data['deals_by_stage']
        self.assertEqual(len(by_stage), 1)
        self.assertEqual(by_stage[0]['stage_id'], other_stage.id)
        self.assertEqual(by_stage[0]['stage_name'], 'Kickoff')
        self.assertEqual(by_stage[0]['count'], 1)
        self.assertEqual(by_stage[0]['value'], 250.0)

    def test_dashboard_leads_breakdowns(self):
        self._seed_org_a()
        self.client.force_authenticate(self.user_a)
        response = self.client.get(DASHBOARD_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

        by_source = response.data['leads_by_source']
        self.assertIn({'source': 'website', 'count': 1}, by_source)
        self.assertIn({'source': 'other', 'count': 1}, by_source)

        by_status = response.data['leads_by_status']
        self.assertEqual(
            [entry['status'] for entry in by_status],
            ['new', 'contacted', 'qualified', 'unqualified', 'converted'],
        )
        counts = {entry['status']: entry['count'] for entry in by_status}
        self.assertEqual(counts['new'], 1)
        self.assertEqual(counts['contacted'], 1)
        self.assertEqual(counts['qualified'], 0)

    def test_dashboard_activities(self):
        self._seed_org_a()
        self.client.force_authenticate(self.user_a)
        response = self.client.get(DASHBOARD_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

        recent = response.data['recent_activities']
        self.assertEqual(len(recent), 2)
        for item in recent:
            self.assertEqual(
                sorted(item.keys()), ['completed', 'created_at', 'due_at', 'id', 'title', 'type']
            )

        upcoming = response.data['upcoming_activities']
        self.assertEqual(len(upcoming), 1)
        self.assertEqual(upcoming[0]['title'], 'Follow up')
        self.assertFalse(upcoming[0]['completed'])
        self.assertIsNotNone(upcoming[0]['due_at'])

    def test_tenant_isolation(self):
        self._seed_org_a()
        self.client.force_authenticate(self.user_b)
        response = self.client.get(DASHBOARD_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

        totals = response.data['totals']
        for key in totals:
            self.assertEqual(totals[key], 0, key)
        # Org B still has its own default pipeline from registration — every
        # stage must simply report zero deals.
        for entry in response.data['deals_by_stage']:
            self.assertEqual(entry['count'], 0)
            self.assertEqual(entry['value'], 0.0)
        self.assertEqual(len(response.data['revenue_by_month']), 6)
        self.assertTrue(all(entry['count'] == 0 for entry in response.data['revenue_by_month']))
        self.assertEqual(response.data['leads_by_source'], [])
        self.assertEqual(response.data['recent_activities'], [])
        self.assertEqual(response.data['upcoming_activities'], [])
        self.assertEqual(response.data['top_deals'], [])

    def test_unauthenticated_rejected(self):
        response = self.client.get(DASHBOARD_URL)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

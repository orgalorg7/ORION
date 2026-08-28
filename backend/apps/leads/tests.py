from decimal import Decimal

from rest_framework import status
from rest_framework.test import APITestCase

from apps.contacts.models import Company, Contact
from apps.deals.models import Deal, Pipeline, Stage
from apps.organizations.services import register_account

from .models import Lead


class LeadApiTests(APITestCase):
    def setUp(self):
        self.user_a, self.org_a = register_account(
            email='a@example.com', password='StrongPass123!', first_name='Alice', organization_name='Org A'
        )
        self.user_b, self.org_b = register_account(
            email='b@example.com', password='StrongPass123!', first_name='Bob', organization_name='Org B'
        )

    def test_create_and_list_lead(self):
        self.client.force_authenticate(self.user_a)
        response = self.client.post(
            '/api/v1/leads/',
            {'first_name': 'Sara', 'last_name': 'Ahmed', 'email': 'sara@example.com', 'company_name': 'Acme'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(Lead.objects.filter(organization=self.org_a).count(), 1)

        response = self.client.get('/api/v1/leads/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 1)

    def test_tenant_isolation(self):
        Lead.objects.create(organization=self.org_a, first_name='Private', created_by=self.user_a)
        self.client.force_authenticate(self.user_b)
        response = self.client.get('/api/v1/leads/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 0)

    def test_cannot_set_status_converted_via_update(self):
        lead = Lead.objects.create(organization=self.org_a, first_name='Sara', created_by=self.user_a)
        self.client.force_authenticate(self.user_a)
        response = self.client.patch(f'/api/v1/leads/{lead.id}/', {'status': 'converted'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        response = self.client.patch(f'/api/v1/leads/{lead.id}/', {'status': 'qualified'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['status'], 'qualified')

    def test_convert_without_deal(self):
        lead = Lead.objects.create(
            organization=self.org_a,
            created_by=self.user_a,
            first_name='Sara',
            last_name='Ahmed',
            email='sara@example.com',
            phone='+201001234567',
            company_name='Acme',
            job_title='CTO',
            source='website',
            owner=self.user_a,
            description='Hot lead',
        )
        self.client.force_authenticate(self.user_a)
        response = self.client.post(f'/api/v1/leads/{lead.id}/convert/', {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertIsNone(response.data['deal_id'])

        contact = Contact.objects.get(id=response.data['contact_id'])
        self.assertEqual(contact.organization, self.org_a)
        self.assertEqual(contact.first_name, 'Sara')
        self.assertEqual(contact.last_name, 'Ahmed')
        self.assertEqual(contact.email, 'sara@example.com')
        self.assertEqual(contact.job_title, 'CTO')
        self.assertEqual(contact.source, 'website')
        self.assertEqual(contact.owner, self.user_a)

        company = Company.objects.get(id=response.data['company_id'])
        self.assertEqual(company.organization, self.org_a)
        self.assertEqual(company.name, 'Acme')
        self.assertEqual(contact.company, company)

        lead.refresh_from_db()
        self.assertEqual(lead.status, Lead.Status.CONVERTED)
        self.assertIsNotNone(lead.converted_at)
        self.assertEqual(lead.converted_contact, contact)
        self.assertIsNone(lead.converted_deal)
        self.assertEqual(response.data['lead']['status'], 'converted')

    def test_convert_without_company_name(self):
        lead = Lead.objects.create(organization=self.org_a, first_name='Solo', created_by=self.user_a)
        self.client.force_authenticate(self.user_a)
        response = self.client.post(f'/api/v1/leads/{lead.id}/convert/', {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertIsNone(response.data['company_id'])
        self.assertEqual(Company.objects.filter(organization=self.org_a).count(), 0)

    def test_convert_with_deal_defaults(self):
        lead = Lead.objects.create(
            organization=self.org_a,
            created_by=self.user_a,
            first_name='Sara',
            last_name='Ahmed',
            company_name='Acme',
            estimated_value=Decimal('5000.00'),
            owner=self.user_a,
        )
        self.client.force_authenticate(self.user_a)
        response = self.client.post(f'/api/v1/leads/{lead.id}/convert/', {'create_deal': True}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertIsNotNone(response.data['deal_id'])

        deal = Deal.objects.get(id=response.data['deal_id'])
        self.assertEqual(deal.organization, self.org_a)
        self.assertEqual(deal.title, 'Sara Ahmed deal')
        self.assertEqual(deal.value, Decimal('5000.00'))
        self.assertEqual(deal.currency, self.org_a.currency)

        default_pipeline = Pipeline.objects.get(organization=self.org_a, is_default=True)
        self.assertEqual(deal.pipeline, default_pipeline)
        self.assertEqual(deal.stage, default_pipeline.stages.order_by('order', 'id').first())
        self.assertEqual(deal.contact_id, response.data['contact_id'])
        self.assertEqual(deal.company_id, response.data['company_id'])
        self.assertEqual(deal.owner, self.user_a)

        lead.refresh_from_db()
        self.assertEqual(lead.converted_deal, deal)

    def test_convert_with_deal_explicit_fields(self):
        pipeline = Pipeline.objects.create(organization=self.org_a, created_by=self.user_a, name='Custom')
        stage = Stage.objects.create(
            organization=self.org_a, created_by=self.user_a, pipeline=pipeline, name='Won-ish', order=0
        )
        lead = Lead.objects.create(organization=self.org_a, first_name='Sara', created_by=self.user_a)
        self.client.force_authenticate(self.user_a)
        response = self.client.post(
            f'/api/v1/leads/{lead.id}/convert/',
            {
                'create_deal': True,
                'deal_title': 'Big deal',
                'deal_value': '1234.50',
                'pipeline': pipeline.id,
                'stage': stage.id,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        deal = Deal.objects.get(id=response.data['deal_id'])
        self.assertEqual(deal.title, 'Big deal')
        self.assertEqual(deal.value, Decimal('1234.50'))
        self.assertEqual(deal.pipeline, pipeline)
        self.assertEqual(deal.stage, stage)

    def test_convert_twice_returns_400(self):
        lead = Lead.objects.create(organization=self.org_a, first_name='Sara', created_by=self.user_a)
        self.client.force_authenticate(self.user_a)
        response = self.client.post(f'/api/v1/leads/{lead.id}/convert/', {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

        response = self.client.post(f'/api/v1/leads/{lead.id}/convert/', {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('detail', response.data)

    def test_convert_isolation(self):
        lead = Lead.objects.create(organization=self.org_a, first_name='Private', created_by=self.user_a)
        self.client.force_authenticate(self.user_b)
        response = self.client.post(f'/api/v1/leads/{lead.id}/convert/', {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_convert_rejects_other_org_pipeline(self):
        foreign_pipeline = Pipeline.objects.get(organization=self.org_b, is_default=True)
        lead = Lead.objects.create(organization=self.org_a, first_name='Sara', created_by=self.user_a)
        self.client.force_authenticate(self.user_a)
        response = self.client.post(
            f'/api/v1/leads/{lead.id}/convert/',
            {'create_deal': True, 'pipeline': foreign_pipeline.id},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_convert_rejects_stage_from_other_pipeline(self):
        default_pipeline = Pipeline.objects.get(organization=self.org_a, is_default=True)
        other_pipeline = Pipeline.objects.create(organization=self.org_a, name='Renewals')
        other_stage = Stage.objects.create(
            organization=self.org_a, pipeline=other_pipeline, name='Kickoff', order=0
        )
        lead = Lead.objects.create(organization=self.org_a, first_name='Sara', created_by=self.user_a)
        self.client.force_authenticate(self.user_a)
        response = self.client.post(
            f'/api/v1/leads/{lead.id}/convert/',
            {'create_deal': True, 'pipeline': default_pipeline.id, 'stage': other_stage.id},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Deal.objects.filter(organization=self.org_a).count(), 0)

    def test_editing_converted_lead_keeps_status(self):
        lead = Lead.objects.create(organization=self.org_a, first_name='Sara', created_by=self.user_a)
        self.client.force_authenticate(self.user_a)
        self.client.post(f'/api/v1/leads/{lead.id}/convert/', {}, format='json')
        # The edit form resends the current status — a no-op 'converted' must be accepted.
        response = self.client.patch(
            f'/api/v1/leads/{lead.id}/',
            {'first_name': 'Sara-updated', 'status': 'converted'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['status'], 'converted')
        # But a non-converted lead still cannot be flipped to converted directly.
        fresh = Lead.objects.create(organization=self.org_a, first_name='Nour', created_by=self.user_a)
        response = self.client.patch(f'/api/v1/leads/{fresh.id}/', {'status': 'converted'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unauthenticated_rejected(self):
        response = self.client.get('/api/v1/leads/')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

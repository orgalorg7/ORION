from rest_framework import status
from rest_framework.test import APITestCase

from apps.organizations.services import register_account

from .models import Deal, Pipeline, Stage


class DealApiTests(APITestCase):
    def setUp(self):
        self.user_a, self.org_a = register_account(
            email='a@example.com', password='StrongPass123!', first_name='Alice', organization_name='Org A'
        )
        self.user_b, self.org_b = register_account(
            email='b@example.com', password='StrongPass123!', first_name='Bob', organization_name='Org B'
        )
        # register_account creates a default pipeline with stages for each org.
        self.pipeline_a = Pipeline.objects.get(organization=self.org_a)
        self.pipeline_b = Pipeline.objects.get(organization=self.org_b)

    def _create_deal(self, **overrides):
        data = {'title': 'Big deal', 'pipeline': self.pipeline_a.id}
        data.update(overrides)
        return self.client.post('/api/v1/deals/', data, format='json')

    def test_create_and_list_deal(self):
        self.org_a.currency = 'EGP'
        self.org_a.save(update_fields=['currency'])
        self.client.force_authenticate(self.user_a)
        response = self._create_deal()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        first_stage = self.pipeline_a.stages.order_by('order', 'id').first()
        self.assertEqual(response.data['stage'], first_stage.id)
        self.assertEqual(response.data['stage_detail']['id'], first_stage.id)
        self.assertEqual(response.data['currency'], 'EGP')
        self.assertEqual(response.data['status'], 'open')

        response = self.client.get('/api/v1/deals/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 1)

    def test_tenant_isolation(self):
        Deal.objects.create(
            organization=self.org_a, created_by=self.user_a, title='Private', pipeline=self.pipeline_a
        )
        self.client.force_authenticate(self.user_b)
        response = self.client.get('/api/v1/deals/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 0)
        # A pipeline belonging to another org cannot be referenced either.
        response = self._create_deal()
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_stage_must_belong_to_pipeline(self):
        other_pipeline = Pipeline.objects.create(
            organization=self.org_a, created_by=self.user_a, name='Renewals'
        )
        other_stage = Stage.objects.create(
            organization=self.org_a, created_by=self.user_a, pipeline=other_pipeline, name='Kickoff'
        )
        self.client.force_authenticate(self.user_a)
        response = self._create_deal(stage=other_stage.id)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_move_action(self):
        self.client.force_authenticate(self.user_a)
        deal_id = self._create_deal().data['id']
        target = self.pipeline_a.stages.order_by('order', 'id').last()
        response = self.client.post(f'/api/v1/deals/{deal_id}/move/', {'stage': target.id}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['stage'], target.id)

    def test_move_rejects_stage_from_other_pipeline(self):
        other_pipeline = Pipeline.objects.create(
            organization=self.org_a, created_by=self.user_a, name='Renewals'
        )
        other_stage = Stage.objects.create(
            organization=self.org_a, created_by=self.user_a, pipeline=other_pipeline, name='Kickoff'
        )
        foreign_stage = self.pipeline_b.stages.first()
        self.client.force_authenticate(self.user_a)
        deal_id = self._create_deal().data['id']
        for stage in (other_stage, foreign_stage):
            response = self.client.post(f'/api/v1/deals/{deal_id}/move/', {'stage': stage.id}, format='json')
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_mark_won_lost_and_reopen(self):
        self.client.force_authenticate(self.user_a)
        deal_id = self._create_deal().data['id']

        response = self.client.post(f'/api/v1/deals/{deal_id}/mark-won/')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['status'], 'won')
        self.assertIsNotNone(response.data['closed_at'])

        response = self.client.post(
            f'/api/v1/deals/{deal_id}/mark-lost/', {'lost_reason': 'Budget cut'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['status'], 'lost')
        self.assertEqual(response.data['lost_reason'], 'Budget cut')
        self.assertIsNotNone(response.data['closed_at'])

        response = self.client.post(f'/api/v1/deals/{deal_id}/reopen/')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['status'], 'open')
        self.assertIsNone(response.data['closed_at'])
        self.assertEqual(response.data['lost_reason'], '')

    def test_status_not_writable_directly(self):
        self.client.force_authenticate(self.user_a)
        response = self._create_deal(status='won')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data['status'], 'open')

    def test_cannot_delete_only_pipeline(self):
        self.client.force_authenticate(self.user_a)
        response = self.client.delete(f'/api/v1/pipelines/{self.pipeline_a.id}/')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        second = Pipeline.objects.create(organization=self.org_a, created_by=self.user_a, name='Renewals')
        response = self.client.delete(f'/api/v1/pipelines/{second.id}/')
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

    def test_default_pipeline_is_exclusive(self):
        self.client.force_authenticate(self.user_a)
        response = self.client.post(
            '/api/v1/pipelines/', {'name': 'Renewals', 'is_default': True}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.pipeline_a.refresh_from_db()
        self.assertFalse(self.pipeline_a.is_default)
        # Other organizations are untouched.
        self.pipeline_b.refresh_from_db()
        self.assertTrue(self.pipeline_b.is_default)

    def test_pipeline_list_is_plain_array_with_stages(self):
        self.client.force_authenticate(self.user_a)
        response = self.client.get('/api/v1/pipelines/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsInstance(response.data, list)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(len(response.data[0]['stages']), self.pipeline_a.stages.count())

    def test_stage_create_scoped_to_org(self):
        self.client.force_authenticate(self.user_a)
        response = self.client.post(
            '/api/v1/stages/', {'pipeline': self.pipeline_b.id, 'name': 'Sneaky'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        response = self.client.post(
            '/api/v1/stages/', {'pipeline': self.pipeline_a.id, 'name': 'Extra', 'order': 9}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

from decimal import Decimal
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.contacts.models import Company, Contact, Tag
from apps.customer_core.models import CustomFieldDefinition, DomainEvent
from apps.organizations.models import Membership
from apps.organizations.services import register_account

from .models import Deal, DealContact, DealLineItem, DealStageHistory, LostReason, Pipeline, Product, Stage


class DealEngineApiTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user_a, cls.org_a = register_account(
            email='a@example.com', password='StrongPass123!', first_name='Alice', organization_name='Org A'
        )
        cls.user_b, cls.org_b = register_account(
            email='b@example.com', password='StrongPass123!', first_name='Bob', organization_name='Org B'
        )
        cls.pipeline_a = Pipeline.objects.get(organization=cls.org_a)
        cls.pipeline_b = Pipeline.objects.get(organization=cls.org_b)

    def setUp(self):
        self.client.force_authenticate(self.user_a)

    def open_stage(self, pipeline=None, offset=0):
        return (pipeline or self.pipeline_a).stages.filter(stage_type=Stage.Type.OPEN).order_by('order')[offset]

    def won_stage(self, pipeline=None):
        return (pipeline or self.pipeline_a).stages.get(stage_type=Stage.Type.WON)

    def lost_stage(self, pipeline=None):
        return (pipeline or self.pipeline_a).stages.get(stage_type=Stage.Type.LOST)

    def create_deal(self, **overrides):
        data = {'title': 'Enterprise rollout', 'pipeline': self.pipeline_a.id, 'value': '125000.00', 'currency': 'EGP'}
        data.update(overrides)
        return self.client.post('/api/v1/deals/', data, format='json')

    def test_create_list_search_filter_sort_and_pagination(self):
        response = self.create_deal(priority='high', source='referral')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data['stage'], self.open_stage().id)
        self.assertEqual(response.data['probability'], self.open_stage().probability)
        self.assertEqual(Decimal(response.data['weighted_value']), Decimal('12500.00'))
        self.assertEqual(DealStageHistory.objects.filter(deal_id=response.data['id'], exited_at__isnull=True).count(), 1)
        listed = self.client.get('/api/v1/deals/', {'search': 'enterprise', 'priority': 'high', 'ordering': '-value'})
        self.assertEqual(listed.status_code, 200, listed.data)
        self.assertEqual(listed.data['count'], 1)
        self.assertEqual(listed.data['results'][0]['id'], response.data['id'])

    def test_custom_fields_tags_notes_timeline_are_reused(self):
        CustomFieldDefinition.objects.create(
            organization=self.org_a, created_by=self.user_a, updated_by=self.user_a,
            target_object='deal', key='contract_type', label='Contract type', data_type='select',
            options=['annual', 'monthly'], required=True,
        )
        rejected = self.create_deal()
        self.assertEqual(rejected.status_code, 400)
        created = self.create_deal(custom_fields={'contract_type': 'annual'})
        self.assertEqual(created.status_code, 201, created.data)
        deal_id = created.data['id']
        tag = Tag.objects.create(organization=self.org_a, created_by=self.user_a, name='Strategic')
        tagged = self.client.post(
            f'/api/v1/deals/{deal_id}/tags/', {'operation': 'attach', 'tag_ids': [tag.id]}, format='json'
        )
        self.assertEqual(tagged.status_code, 200, tagged.data)
        note = self.client.post('/api/v1/notes/', {'deal': deal_id, 'body': 'Procurement approved'}, format='json')
        self.assertEqual(note.status_code, 201, note.data)
        activity = self.client.post(
            '/api/v1/activities/', {'deal': deal_id, 'type': 'call', 'title': 'Commercial follow-up'}, format='json'
        )
        self.assertEqual(activity.status_code, 201, activity.data)
        timeline = self.client.get(f'/api/v1/deals/{deal_id}/timeline/')
        self.assertEqual(timeline.status_code, 200)
        event_types = {event['event_type'] for event in timeline.data['results']}
        self.assertIn('deal.created', event_types)
        self.assertIn('tag.attached', event_types)
        self.assertIn('deal.note_created', event_types)
        self.assertIn('deal.activity_created', event_types)

    def test_move_stage_creates_history_audit_and_event(self):
        created = self.create_deal().data
        target = self.open_stage(offset=1)
        response = self.client.post(
            f"/api/v1/deals/{created['id']}/move-stage/",
            {'stage': target.id, 'expected_version': created['version']}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['stage'], target.id)
        self.assertEqual(response.data['version'], created['version'] + 1)
        history = DealStageHistory.objects.filter(deal_id=created['id']).order_by('entered_at')
        self.assertEqual(history.count(), 2)
        self.assertIsNotNone(history.first().exited_at)
        self.assertIsNone(history.last().exited_at)
        self.assertTrue(DomainEvent.objects.filter(object_id=created['id'], event_type='deal.stage_changed').exists())

    def test_won_lost_and_reopen_preserve_outcome_history(self):
        created = self.create_deal().data
        won = self.client.post(
            f"/api/v1/deals/{created['id']}/mark-won/",
            {'actual_close_date': '2026-08-31', 'expected_version': created['version']}, format='json',
        )
        self.assertEqual(won.status_code, 200, won.data)
        self.assertEqual(won.data['status'], 'won')
        self.assertEqual(won.data['probability'], 100)
        self.assertEqual(won.data['actual_close_date'], '2026-08-31')
        blocked = self.client.post(
            f"/api/v1/deals/{created['id']}/mark-lost/", {'lost_reason': LostReason.objects.filter(organization=self.org_a).first().id}, format='json'
        )
        self.assertEqual(blocked.status_code, 400)
        reopened = self.client.post(
            f"/api/v1/deals/{created['id']}/reopen/",
            {'stage': self.open_stage().id, 'expected_version': won.data['version']}, format='json',
        )
        self.assertEqual(reopened.status_code, 200, reopened.data)
        self.assertEqual(reopened.data['status'], 'open')
        self.assertIsNotNone(reopened.data['won_at'])
        reason = LostReason.objects.get(organization=self.org_a, normalized_label='competitor')
        lost = self.client.post(
            f"/api/v1/deals/{created['id']}/mark-lost/",
            {'lost_reason': reason.id, 'lost_reason_text': 'Incumbent discount', 'expected_version': reopened.data['version']},
            format='json',
        )
        self.assertEqual(lost.status_code, 200, lost.data)
        self.assertEqual(lost.data['lost_reason_record'], reason.id)
        self.assertEqual(lost.data['probability'], 0)
        self.assertIsNotNone(lost.data['won_at'])
        event_types = list(DomainEvent.objects.filter(object_id=created['id']).values_list('event_type', flat=True))
        self.assertIn('deal.won', event_types)
        self.assertIn('deal.reopened', event_types)
        self.assertIn('deal.lost', event_types)

    def test_abandoned_deal_is_explicit_and_reopenable(self):
        created = self.create_deal().data
        reason = LostReason.objects.get(organization=self.org_a, normalized_label='no response')
        abandoned = self.client.post(
            f"/api/v1/deals/{created['id']}/mark-abandoned/",
            {'lost_reason': reason.id, 'expected_version': created['version']},
            format='json',
        )
        self.assertEqual(abandoned.status_code, 200, abandoned.data)
        self.assertEqual(abandoned.data['status'], 'abandoned')
        self.assertIsNotNone(abandoned.data['abandoned_at'])
        self.assertIsNone(abandoned.data['lost_at'])
        self.assertTrue(DomainEvent.objects.filter(object_id=created['id'], event_type='deal.abandoned').exists())
        reopened = self.client.post(
            f"/api/v1/deals/{created['id']}/reopen/",
            {'stage': self.open_stage().id, 'expected_version': abandoned.data['version']},
            format='json',
        )
        self.assertEqual(reopened.status_code, 200, reopened.data)
        self.assertEqual(reopened.data['status'], 'open')
        self.assertIsNotNone(reopened.data['abandoned_at'])

    def test_cross_pipeline_move_is_explicit_and_audited(self):
        other = self.client.post('/api/v1/pipelines/', {'name': 'Renewals'}, format='json').data
        destination = next(stage for stage in other['stages'] if stage['stage_type'] == 'open')
        created = self.create_deal().data
        wrong_action = self.client.post(
            f"/api/v1/deals/{created['id']}/move-stage/", {'stage': destination['id']}, format='json'
        )
        self.assertEqual(wrong_action.status_code, 400)
        moved = self.client.post(
            f"/api/v1/deals/{created['id']}/move-pipeline/",
            {'stage': destination['id'], 'expected_version': created['version']}, format='json',
        )
        self.assertEqual(moved.status_code, 200, moved.data)
        self.assertEqual(moved.data['pipeline'], other['id'])
        self.assertTrue(DomainEvent.objects.filter(object_id=created['id'], event_type='deal.pipeline_changed').exists())

    def test_optimistic_version_rejects_stale_move_and_edit(self):
        created = self.create_deal().data
        edited = self.client.patch(
            f"/api/v1/deals/{created['id']}/", {'description': 'Fresh', 'expected_version': created['version']}, format='json'
        )
        self.assertEqual(edited.status_code, 200, edited.data)
        stale = self.client.post(
            f"/api/v1/deals/{created['id']}/move-stage/",
            {'stage': self.open_stage(offset=1).id, 'expected_version': created['version']}, format='json',
        )
        self.assertEqual(stale.status_code, 409)

    def test_transition_rolls_back_when_event_recording_fails(self):
        created = self.create_deal().data
        before = Deal.objects.get(pk=created['id'])
        with patch('apps.deals.services.record_event', side_effect=RuntimeError('event store unavailable')):
            with self.assertRaises(RuntimeError):
                self.client.post(
                    f"/api/v1/deals/{created['id']}/move-stage/",
                    {'stage': self.open_stage(offset=1).id}, format='json',
                )
        after = Deal.objects.get(pk=created['id'])
        self.assertEqual(after.stage_id, before.stage_id)
        self.assertEqual(DealStageHistory.objects.filter(deal=after).count(), 1)

    def test_participants_and_product_snapshot_line_totals(self):
        company = Company.objects.create(organization=self.org_a, created_by=self.user_a, name='Acme', currency='EGP')
        contact = Contact.objects.create(
            organization=self.org_a, created_by=self.user_a, first_name='Mona', last_name='Ali', company=company
        )
        created = self.client.post('/api/v1/deals/', {
            'title': 'Product-derived opportunity', 'pipeline': self.pipeline_a.id,
            'company': company.id, 'contact': contact.id, 'value_mode': 'line_items', 'currency': 'EGP',
        }, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        deal_id = created.data['id']
        self.assertTrue(DealContact.objects.filter(deal_id=deal_id, contact=contact, is_primary=True).exists())
        product = Product.objects.create(
            organization=self.org_a, created_by=self.user_a, updated_by=self.user_a,
            name='Implementation', sku='IMP-1', default_price='100.00', currency='EGP',
        )
        item = self.client.post(
            f'/api/v1/deals/{deal_id}/line-items/',
            {'product': product.id, 'name_snapshot': 'Client supplied lie', 'quantity': '2.000',
             'discount_type': 'percent', 'discount_value': '10'},
            format='json',
        )
        self.assertEqual(item.status_code, 201, item.data)
        self.assertEqual(Decimal(item.data['line_total']), Decimal('180.00'))
        product.name = 'Renamed product'
        product.default_price = Decimal('500')
        product.save()
        item_record = DealLineItem.objects.get(pk=item.data['id'])
        self.assertEqual(item_record.name_snapshot, 'Implementation')
        self.assertEqual(Deal.objects.get(pk=deal_id).value, Decimal('180.00'))
        invalid = self.client.post(
            f'/api/v1/deals/{deal_id}/line-items/',
            {'name_snapshot': 'Bad', 'quantity': '0', 'unit_price': '10'}, format='json',
        )
        self.assertEqual(invalid.status_code, 400)
        immutable = self.client.patch(
            f"/api/v1/deals/{deal_id}/line-items/{item.data['id']}/", {'product': None}, format='json'
        )
        self.assertEqual(immutable.status_code, 400, immutable.data)

    def test_line_item_value_mode_cannot_drift_from_product_total(self):
        created = self.create_deal(value='999.00').data
        switched = self.client.patch(
            f"/api/v1/deals/{created['id']}/",
            {'value_mode': 'line_items', 'expected_version': created['version']},
            format='json',
        )
        self.assertEqual(switched.status_code, 200, switched.data)
        self.assertEqual(Decimal(switched.data['value']), Decimal('0'))
        rejected = self.create_deal(value_mode='line_items', value='999.00')
        self.assertEqual(rejected.status_code, 400, rejected.data)
        self.assertIn('value', rejected.data)

    def test_archive_restore_and_won_is_not_archive(self):
        deal_id = self.create_deal().data['id']
        archived = self.client.post(f'/api/v1/deals/{deal_id}/archive/')
        self.assertEqual(archived.status_code, 200)
        self.assertEqual(self.client.get('/api/v1/deals/').data['count'], 0)
        note = self.client.post('/api/v1/notes/', {'deal': deal_id, 'body': 'Archived bypass'}, format='json')
        self.assertEqual(note.status_code, 400, note.data)
        restored = self.client.post(f'/api/v1/deals/{deal_id}/restore/')
        self.assertEqual(restored.status_code, 200)
        self.assertIsNone(restored.data['archived_at'])

    def test_pipeline_stage_reorder_is_atomic_and_integrity_is_enforced(self):
        stages = list(self.pipeline_a.stages.order_by('order'))
        reordered_ids = [stage.id for stage in reversed(stages)]
        response = self.client.post(
            f'/api/v1/pipelines/{self.pipeline_a.id}/reorder-stages/',
            {'stage_ids': reordered_ids, 'expected_version': self.pipeline_a.version}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([stage['id'] for stage in response.data], reordered_ids)
        self.assertEqual(len(set(Stage.objects.filter(pipeline=self.pipeline_a).values_list('order', flat=True))), len(stages))
        deal_id = self.create_deal().data['id']
        current = Deal.objects.get(pk=deal_id).stage
        blocked = self.client.delete(f'/api/v1/stages/{current.id}/')
        self.assertEqual(blocked.status_code, 400)

    def test_database_default_pipeline_constraint(self):
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Pipeline.objects.create(
                    organization=self.org_a, created_by=self.user_a, name='Illegal default', key='illegal', is_default=True
                )
        response = self.client.post('/api/v1/pipelines/', {'name': 'Renewals', 'is_default': True}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.pipeline_a.refresh_from_db()
        self.assertFalse(self.pipeline_a.is_default)

    def test_pipeline_reorder_requires_complete_explicit_set(self):
        second = self.client.post('/api/v1/pipelines/', {'name': 'Upsells'}, format='json').data
        response = self.client.post(
            '/api/v1/pipelines/reorder/', {'pipeline_ids': [second['id'], self.pipeline_a.id]}, format='json'
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            list(Pipeline.objects.filter(organization=self.org_a).order_by('display_order').values_list('id', flat=True)),
            [second['id'], self.pipeline_a.id],
        )
        rejected = self.client.post('/api/v1/pipelines/reorder/', {'pipeline_ids': [second['id']]}, format='json')
        self.assertEqual(rejected.status_code, 400)

    def test_board_is_bounded_and_returns_database_totals(self):
        for index in range(30):
            Deal.objects.create(
                organization=self.org_a, created_by=self.user_a, updated_by=self.user_a,
                title=f'Deal {index}', pipeline=self.pipeline_a, value=10, currency='EGP',
            )
        response = self.client.get('/api/v1/deals/board/', {'pipeline': self.pipeline_a.id, 'limit': 10})
        self.assertEqual(response.status_code, 200, response.data)
        first = next(column for column in response.data['columns'] if column['stage']['id'] == self.open_stage().id)
        self.assertEqual(len(first['deals']), 10)
        self.assertTrue(first['has_more'], first)
        self.assertEqual(first['totals'][0]['count'], 30)

        tagged = self.create_deal(value='125.00').data
        tags = [Tag.objects.create(organization=self.org_a, created_by=self.user_a, name=name) for name in ('A', 'B')]
        Deal.objects.get(pk=tagged['id']).tags.add(*tags)
        filtered = self.client.get('/api/v1/deals/board/', {
            'pipeline': self.pipeline_a.id, 'tags': ','.join(str(tag.id) for tag in tags),
        })
        column = next(item for item in filtered.data['columns'] if item['stage']['id'] == self.open_stage().id)
        self.assertEqual(column['totals'][0]['count'], 1)
        self.assertEqual(Decimal(column['totals'][0]['value']), Decimal('125.00'))

    def test_stale_filter_uses_pipeline_specific_thresholds(self):
        self.pipeline_a.stale_stage_days = 0
        self.pipeline_a.save(update_fields=['stale_stage_days', 'updated_at'])
        deal_id = self.create_deal().data['id']
        response = self.client.get('/api/v1/deals/', {'stale': 'true'})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([row['id'] for row in response.data['results']], [deal_id])

    def test_analytics_and_forecast_aggregate_in_tenant_scope(self):
        open_deal = self.create_deal(value='1000', expected_close_date='2026-09-15').data
        won = self.create_deal(value='2000').data
        self.client.post(f"/api/v1/deals/{won['id']}/mark-won/", {'actual_close_date': '2026-08-31'}, format='json')
        Deal.objects.create(
            organization=self.org_b, created_by=self.user_b, title='Foreign million',
            pipeline=self.pipeline_b, value=999999, currency='EGP',
        )
        analytics = self.client.get('/api/v1/pipeline-analytics/', {'pipeline': self.pipeline_a.id})
        self.assertEqual(analytics.status_code, 200, analytics.data)
        self.assertEqual(analytics.data['open_pipeline'][0]['count'], 1)
        self.assertEqual(Decimal(analytics.data['won'][0]['value']), Decimal('2000'))
        self.assertTrue(all('conversion_rate' in row for row in analytics.data['stage_conversions']))
        forecast = self.client.get('/api/v1/forecasts/', {'pipeline': self.pipeline_a.id, 'period': 'month'})
        self.assertEqual(forecast.status_code, 200, forecast.data)
        self.assertTrue(forecast.data['results'])
        self.assertEqual(self.client.get('/api/v1/pipeline-analytics/', {'pipeline': '1 OR 1=1'}).status_code, 400)

    def test_deal_import_and_export_use_generic_secure_workflow(self):
        csv_file = SimpleUploadedFile(
            'deals.csv', b'Deal Name,Amount,Pipeline\nImported Deal,4500,Sales Pipeline\n', content_type='text/csv'
        )
        upload = self.client.post('/api/v1/imports/', {'target_object': 'deal', 'source_file': csv_file}, format='multipart')
        self.assertEqual(upload.status_code, 201, upload.data)
        processed = self.client.post(
            f"/api/v1/imports/{upload.data['id']}/process/",
            {'mapping': {'Deal Name': 'title', 'Amount': 'value', 'Pipeline': 'pipeline_name'}, 'duplicate_policy': 'create'},
            format='json',
        )
        self.assertEqual(processed.status_code, 200, processed.data)
        self.assertEqual(processed.data['report']['successful'], 1)
        dangerous = self.create_deal(title='=CMD(1)').data
        exported = self.client.post(
            '/api/v1/exports/', {'target_object': 'deal', 'filters': {'pipeline': self.pipeline_a.id}, 'fields': ['title', 'value']},
            format='json',
        )
        self.assertEqual(exported.status_code, 200)
        body = b''.join(exported.streaming_content).decode('utf-8-sig')
        self.assertIn("'=CMD(1)", body)
        malformed = self.client.post(
            '/api/v1/exports/', {'target_object': 'deal', 'fields': {'title': True}}, format='json'
        )
        self.assertEqual(malformed.status_code, 400, malformed.data)


class DealTenantSecurityTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user_a, cls.org_a = register_account(
            email='secure-a@example.com', password='StrongPass123!', first_name='A', organization_name='Secure A'
        )
        cls.user_b, cls.org_b = register_account(
            email='secure-b@example.com', password='StrongPass123!', first_name='B', organization_name='Secure B'
        )
        cls.pipeline_a = Pipeline.objects.get(organization=cls.org_a)
        cls.pipeline_b = Pipeline.objects.get(organization=cls.org_b)
        cls.deal_b = Deal.objects.create(
            organization=cls.org_b, created_by=cls.user_b, updated_by=cls.user_b,
            title='Tenant B Secret', pipeline=cls.pipeline_b, value=987654,
        )
        cls.contact_b = Contact.objects.create(organization=cls.org_b, created_by=cls.user_b, first_name='Secret')
        cls.company_b = Company.objects.create(organization=cls.org_b, created_by=cls.user_b, name='Secret Co')
        cls.product_b = Product.objects.create(
            organization=cls.org_b, created_by=cls.user_b, name='Secret Product', default_price=50, currency='USD'
        )

    def setUp(self):
        self.client.force_authenticate(self.user_a)

    def test_direct_idor_get_update_archive_and_guessed_id(self):
        for method, path, data in (
            ('get', f'/api/v1/deals/{self.deal_b.id}/', None),
            ('patch', f'/api/v1/deals/{self.deal_b.id}/', {'title': 'Stolen'}),
            ('post', f'/api/v1/deals/{self.deal_b.id}/archive/', {}),
            ('get', '/api/v1/deals/999999999/', None),
        ):
            response = getattr(self.client, method)(path, data=data, format='json')
            self.assertEqual(response.status_code, 404, response.data)

    def test_list_search_board_analytics_forecast_do_not_leak(self):
        self.assertEqual(self.client.get('/api/v1/deals/', {'search': 'Tenant B Secret'}).data['count'], 0)
        foreign_board = self.client.get('/api/v1/deals/board/', {'pipeline': self.pipeline_b.id})
        self.assertEqual(foreign_board.status_code, 400)
        analytics = self.client.get('/api/v1/pipeline-analytics/', {'pipeline': self.pipeline_b.id})
        self.assertEqual(analytics.status_code, 200)
        self.assertEqual(analytics.data['open_pipeline'], [])
        forecast = self.client.get('/api/v1/forecasts/', {'pipeline': self.pipeline_b.id})
        self.assertEqual(forecast.data['results'], [])

    def test_foreign_pipeline_stage_contact_company_owner_product_and_reason_rejected(self):
        foreign_stage = self.pipeline_b.stages.filter(stage_type='open').first()
        for field, value in (
            ('pipeline', self.pipeline_b.id), ('stage', foreign_stage.id), ('contact', self.contact_b.id),
            ('company', self.company_b.id), ('owner', self.user_b.id),
        ):
            response = self.client.post('/api/v1/deals/', {'title': 'Attack', 'pipeline': self.pipeline_a.id, field: value}, format='json')
            self.assertEqual(response.status_code, 400, (field, response.data))
        own = self.client.post('/api/v1/deals/', {'title': 'Own', 'pipeline': self.pipeline_a.id}, format='json').data
        item = self.client.post(
            f"/api/v1/deals/{own['id']}/line-items/", {'product': self.product_b.id, 'quantity': 1}, format='json'
        )
        self.assertEqual(item.status_code, 400, item.data)
        reason_b = LostReason.objects.filter(organization=self.org_b).first()
        lost = self.client.post(f"/api/v1/deals/{own['id']}/mark-lost/", {'lost_reason': reason_b.id}, format='json')
        self.assertEqual(lost.status_code, 400, lost.data)
        mass_assignment = self.client.patch(
            f"/api/v1/deals/{own['id']}/",
            {'status': 'won', 'lost_reason_record': LostReason.objects.filter(organization=self.org_a).first().id},
            format='json',
        )
        self.assertEqual(mass_assignment.status_code, 200, mass_assignment.data)
        self.assertEqual(mass_assignment.data['status'], 'open')
        self.assertIsNone(mass_assignment.data['lost_reason_record'])
        with self.assertRaises(ValidationError):
            Deal.objects.create(
                organization=self.org_a, created_by=self.user_a, title='Persistence attack',
                pipeline=self.pipeline_a, contact=self.contact_b,
            )

    def test_bulk_foreign_id_is_all_or_nothing(self):
        own = self.client.post('/api/v1/deals/', {'title': 'Own', 'pipeline': self.pipeline_a.id}, format='json').data
        response = self.client.post(
            '/api/v1/deals/bulk/', {'ids': [own['id'], self.deal_b.id], 'operation': 'archive'}, format='json'
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIsNone(Deal.objects.get(pk=own['id']).archived_at)

    def test_non_admin_cannot_manage_pipeline_or_bulk(self):
        Membership.objects.filter(organization=self.org_a, user=self.user_a).update(role=Membership.Role.MEMBER)
        pipeline = self.client.post('/api/v1/pipelines/', {'name': 'Unauthorized'}, format='json')
        self.assertEqual(pipeline.status_code, 403)
        own = Deal.objects.create(organization=self.org_a, created_by=self.user_a, title='Mine', pipeline=self.pipeline_a)
        bulk = self.client.post('/api/v1/deals/bulk/', {'ids': [own.id], 'operation': 'archive'}, format='json')
        self.assertEqual(bulk.status_code, 403)

    def test_member_cannot_restore_another_owners_archived_deal(self):
        Membership.objects.filter(organization=self.org_a, user=self.user_a).update(role=Membership.Role.MEMBER)
        manager = Membership.objects.create(
            organization=self.org_a, user=self.user_b, role=Membership.Role.MANAGER, is_active=True,
        )
        deal = Deal.objects.create(
            organization=self.org_a, created_by=self.user_b, updated_by=self.user_b,
            owner=manager.user, title='Manager owned', pipeline=self.pipeline_a, archived_at=timezone.now(),
        )
        response = self.client.post(f'/api/v1/deals/{deal.id}/restore/')
        self.assertEqual(response.status_code, 403, response.data)
        deal.refresh_from_db()
        self.assertIsNotNone(deal.archived_at)

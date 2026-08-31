from decimal import Decimal
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError
from django.test import SimpleTestCase, TestCase
from rest_framework import status
from rest_framework.test import APITestCase

from apps.activities.models import Note
from apps.contacts.models import Company, Contact, Tag
from apps.core.normalization import normalize_domain, normalize_email, normalize_name, normalize_phone
from apps.leads.models import Lead
from apps.organizations.services import register_account

from .custom_fields import custom_filter_expression, validate_custom_value
from .duplicates import DuplicateDetectionService
from .models import CustomFieldDefinition, DomainEvent, LeadSource
from .scoring import LeadScoringService
from .serializers import ImportJobSerializer


class NormalizationTests(SimpleTestCase):
    def test_email_domain_name_and_egyptian_phone(self):
        self.assertEqual(normalize_email(' USER@Example.COM '), 'user@example.com')
        self.assertEqual(normalize_domain('https://www.Example.com/'), 'example.com')
        self.assertEqual(normalize_domain('sales.example.com/'), 'sales.example.com')
        self.assertEqual(normalize_phone('0100 123 4567', 'EG'), '+201001234567')
        self.assertEqual(normalize_phone('(0100) 1234567', 'EG'), '+201001234567')
        self.assertEqual(normalize_name('  مُحَمَّد   أحمد  '), 'مُحَمَّد أحمد')


class CustomFieldUnitTests(TestCase):
    def setUp(self):
        self.user, self.org = register_account(
            email='fields@example.com', password='StrongPass123!', first_name='Fields', organization_name='Fields Org'
        )

    def definition(self, data_type, **kwargs):
        return CustomFieldDefinition.objects.create(
            organization=self.org,
            target_object='lead',
            key=f'field-{CustomFieldDefinition.objects.count()}',
            label='Field',
            data_type=data_type,
            **kwargs,
        )

    def test_integer_date_select_and_required_validation(self):
        from rest_framework.serializers import ValidationError

        with self.assertRaises(ValidationError):
            validate_custom_value(self.definition('integer'), '12.8')
        with self.assertRaises(ValidationError):
            validate_custom_value(self.definition('date'), 'banana')
        with self.assertRaises(ValidationError):
            validate_custom_value(self.definition('select', options=['vip', 'standard']), 'unknown')
        with self.assertRaises(ValidationError):
            validate_custom_value(self.definition('text', required=True), '')
        with self.assertRaises(ValidationError):
            validate_custom_value(self.definition('decimal', validation_rules={'precision': 2}), '1.234')

    def test_filter_parser_is_type_aware(self):
        from rest_framework.serializers import ValidationError

        number = self.definition('decimal')
        field_lookup, value = custom_filter_expression(number, 'gte', '12.8')
        self.assertEqual(field_lookup, 'number_value__gte')
        self.assertEqual(value, Decimal('12.8'))
        with self.assertRaises(ValidationError):
            custom_filter_expression(number, 'contains', '12')
        with self.assertRaises(ValidationError):
            custom_filter_expression(self.definition('boolean'), 'exact', 'perhaps')


class ScoringAndDuplicateUnitTests(TestCase):
    def setUp(self):
        self.user, self.org = register_account(
            email='score@example.com', password='StrongPass123!', first_name='Score', organization_name='Score Org'
        )

    def test_deterministic_rule_breakdown(self):
        lead = Lead.objects.create(
            organization=self.org,
            created_by=self.user,
            first_name='Mona',
            email='mona@example.com',
            phone='+201001234567',
            company_name='Acme',
            source='referral',
            estimated_value=Decimal('12000'),
        )
        first = LeadScoringService.calculate(lead)
        second = LeadScoringService.calculate(lead)
        self.assertEqual(first, second)
        self.assertEqual(first['score'], 55)
        self.assertEqual({reason['rule'] for reason in first['reasons']}, {
            'EMAIL_PRESENT', 'PHONE_PRESENT', 'COMPANY_KNOWN', 'REFERRAL_SOURCE', 'HIGH_VALUE'
        })

    def test_duplicate_match_is_structured_and_tenant_scoped(self):
        Lead.objects.create(
            organization=self.org,
            created_by=self.user,
            first_name='Mohamed',
            last_name='Ahmed',
            email='mohamed@example.com',
            phone='+201001234567',
        )
        other_user, other_org = register_account(
            email='other-score@example.com', password='StrongPass123!', first_name='Other', organization_name='Other Score Org'
        )
        Lead.objects.create(
            organization=other_org, created_by=other_user, first_name='Secret', email='secret@example.com'
        )
        candidates = DuplicateDetectionService.check(
            organization=self.org,
            target_type='lead',
            data={'email': 'MOHAMED@example.com', 'phone': '+201001234567'},
        )
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]['confidence_score'], 0.99)
        self.assertEqual(candidates[0]['match_reasons'], ['same_email', 'same_phone'])
        self.assertFalse(any(item['display_name'] == 'Secret' for item in candidates))


class CustomerCoreApiTests(APITestCase):
    def setUp(self):
        self.user_a, self.org_a = register_account(
            email='a-core@example.com', password='StrongPass123!', first_name='Alice', organization_name='Core A'
        )
        self.user_b, self.org_b = register_account(
            email='b-core@example.com', password='StrongPass123!', first_name='Bob', organization_name='Core B'
        )
        self.client.force_authenticate(self.user_a)

    def test_custom_fields_create_validate_filter_and_unique(self):
        definition = self.client.post(
            '/api/v1/custom-fields/',
            {'target_object': 'lead', 'key': 'account-code', 'label': 'Account code', 'data_type': 'integer', 'required': True, 'unique': True},
            format='json',
        )
        self.assertEqual(definition.status_code, status.HTTP_201_CREATED, definition.data)
        invalid = self.client.post(
            '/api/v1/leads/', {'first_name': 'Bad', 'custom_fields': {'account-code': '12.8'}}, format='json'
        )
        self.assertEqual(invalid.status_code, status.HTTP_400_BAD_REQUEST)
        created = self.client.post(
            '/api/v1/leads/', {'first_name': 'Good', 'custom_fields': {'account-code': 12}}, format='json'
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        duplicate = self.client.post(
            '/api/v1/leads/', {'first_name': 'Duplicate', 'custom_fields': {'account-code': 12}}, format='json'
        )
        self.assertEqual(duplicate.status_code, status.HTTP_400_BAD_REQUEST)
        filtered = self.client.get('/api/v1/leads/?custom__account-code__gte=10')
        self.assertEqual(filtered.status_code, status.HTTP_200_OK, filtered.data)
        self.assertEqual(filtered.data['count'], 1)

    def test_tag_normalization_attach_many_filter_and_archive(self):
        first = self.client.post('/api/v1/tags/', {'name': ' VIP '}, format='json')
        second = self.client.post('/api/v1/tags/', {'name': 'vip'}, format='json')
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)
        hot = self.client.post('/api/v1/tags/', {'name': 'Hot'}, format='json').data
        lead = self.client.post('/api/v1/leads/', {'first_name': 'Tagged'}, format='json').data
        attached = self.client.post(
            f"/api/v1/leads/{lead['id']}/tags/",
            {'operation': 'attach', 'tag_ids': [first.data['id'], hot['id']]},
            format='json',
        )
        self.assertEqual(attached.status_code, status.HTTP_200_OK, attached.data)
        filtered = self.client.get(f"/api/v1/leads/?tags_all={first.data['id']},{hot['id']}")
        self.assertEqual(filtered.data['count'], 1)
        archived = self.client.delete(f"/api/v1/tags/{hot['id']}/")
        self.assertEqual(archived.status_code, status.HTTP_204_NO_CONTENT)

    def test_note_event_and_paginated_timeline(self):
        lead = self.client.post('/api/v1/leads/', {'first_name': 'Timeline'}, format='json').data
        note = self.client.post('/api/v1/notes/', {'lead': lead['id'], 'body': '<b>safe text</b>'}, format='json')
        self.assertEqual(note.status_code, status.HTTP_201_CREATED, note.data)
        timeline = self.client.get(f"/api/v1/leads/{lead['id']}/timeline/?page_size=1")
        self.assertEqual(timeline.status_code, status.HTTP_200_OK)
        self.assertIn('results', timeline.data)
        self.assertTrue(DomainEvent.objects.filter(organization=self.org_a, event_type='lead.note_created').exists())

    def test_archive_restore_search_sort_and_explicit_bulk(self):
        lead = self.client.post(
            '/api/v1/leads/', {'first_name': 'أحمد', 'last_name': 'علي', 'email': 'CASE@Example.com'}, format='json'
        ).data
        searched = self.client.get('/api/v1/leads/?search=case@example.com&ordering=display_name')
        self.assertEqual(searched.data['count'], 1)
        archived = self.client.post(f"/api/v1/leads/{lead['id']}/archive/")
        self.assertEqual(archived.status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.get('/api/v1/leads/').data['count'], 0)
        restored = self.client.post(f"/api/v1/leads/{lead['id']}/restore/")
        self.assertEqual(restored.status_code, status.HTTP_200_OK)
        bulk = self.client.post(
            '/api/v1/leads/bulk/', {'ids': [lead['id']], 'operation': 'change_status', 'value': 'qualified'}, format='json'
        )
        self.assertEqual(bulk.status_code, status.HTTP_200_OK, bulk.data)
        self.assertEqual(Lead.objects.get(pk=lead['id']).status, 'qualified')
        self.assertEqual(
            self.client.post('/api/v1/leads/bulk/', {'operation': 'archive'}, format='json').status_code,
            status.HTTP_400_BAD_REQUEST,
        )

    def test_import_preview_process_and_safe_export(self):
        upload = SimpleUploadedFile(
            'customers.csv', b'Customer Name,Mail\r\n=CMD(),csv@example.com\r\n', content_type='text/csv'
        )
        created = self.client.post('/api/v1/imports/', {'target_object': 'lead', 'source_file': upload}, format='multipart')
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        self.assertEqual(created.data['detected_columns'], ['Customer Name', 'Mail'])
        processed = self.client.post(
            f"/api/v1/imports/{created.data['id']}/process/",
            {'mapping': {'Customer Name': 'display_name', 'Mail': 'email'}},
            format='json',
        )
        self.assertEqual(processed.status_code, status.HTTP_200_OK, processed.data)
        self.assertEqual(processed.data['report']['successful'], 1)
        exported = self.client.post(
            '/api/v1/exports/', {'target_object': 'lead', 'fields': ['display_name', 'email']}, format='json'
        )
        self.assertEqual(exported.status_code, status.HTTP_200_OK)
        content = b''.join(exported.streaming_content).decode('utf-8')
        self.assertIn("'=CMD()", content)
        unsafe = self.client.post(
            '/api/v1/exports/', {'target_object': 'lead', 'sort': 'created_at;DROP TABLE leads_lead'}, format='json'
        )
        self.assertEqual(unsafe.status_code, status.HTTP_400_BAD_REQUEST)

    def test_oversized_import_and_custom_field_schema_manipulation_are_rejected(self):
        oversized = SimpleUploadedFile('oversized.csv', b'name\nvalue\n', content_type='text/csv')
        oversized.size = (50 * 1024 * 1024) + 1
        serializer = ImportJobSerializer(data={'target_object': 'lead', 'source_file': oversized})
        self.assertFalse(serializer.is_valid())
        self.assertIn('source_file', serializer.errors)

        invalid_target = self.client.post(
            '/api/v1/custom-fields/',
            {'target_object': '../../accounts.User', 'key': 'role', 'label': 'Role', 'data_type': 'text'},
            format='json',
        )
        invalid_rules = self.client.post(
            '/api/v1/custom-fields/',
            {
                'target_object': 'lead',
                'key': 'unsafe-rule',
                'label': 'Unsafe rule',
                'data_type': 'text',
                'validation_rules': {'sql': 'DROP TABLE leads_lead'},
            },
            format='json',
        )
        self.assertEqual(invalid_target.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(invalid_rules.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unauthenticated_export_and_bulk_are_rejected(self):
        self.client.force_authenticate(user=None)
        export = self.client.post('/api/v1/exports/', {'target_object': 'lead'}, format='json')
        bulk = self.client.post('/api/v1/leads/bulk/', {'ids': [1], 'operation': 'archive'}, format='json')
        self.assertEqual(export.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(bulk.status_code, status.HTTP_401_UNAUTHORIZED)


class TenantIsolationAttackTests(APITestCase):
    def setUp(self):
        self.user_a, self.org_a = register_account(
            email='attack-a@example.com', password='StrongPass123!', first_name='A', organization_name='Attack A'
        )
        self.user_b, self.org_b = register_account(
            email='attack-b@example.com', password='StrongPass123!', first_name='B', organization_name='Attack B'
        )
        self.foreign_company = Company.objects.create(organization=self.org_b, created_by=self.user_b, name='Foreign Co')
        self.foreign_contact = Contact.objects.create(
            organization=self.org_b, created_by=self.user_b, first_name='Foreign', email='secret@foreign.test'
        )
        self.foreign_lead = Lead.objects.create(
            organization=self.org_b, created_by=self.user_b, first_name='Secret', email='leak@foreign.test'
        )
        self.own_lead = Lead.objects.create(organization=self.org_a, created_by=self.user_a, first_name='Own')
        self.client.force_authenticate(self.user_a)

    def test_get_update_archive_uuid_search_and_duplicate_do_not_leak(self):
        self.assertEqual(self.client.get(f'/api/v1/leads/{self.foreign_lead.id}/').status_code, 404)
        self.assertEqual(
            self.client.patch(f'/api/v1/leads/{self.foreign_lead.id}/', {'first_name': 'Hacked'}, format='json').status_code,
            404,
        )
        self.assertEqual(self.client.post(f'/api/v1/contacts/{self.foreign_contact.id}/archive/').status_code, 404)
        self.assertEqual(self.client.get('/api/v1/leads/00000000-0000-0000-0000-000000000001/').status_code, 404)
        self.assertEqual(self.client.get('/api/v1/leads/?search=leak@foreign.test').data['count'], 0)
        duplicate = self.client.post('/api/v1/leads/duplicate-check/', {'email': 'leak@foreign.test'}, format='json')
        self.assertEqual(duplicate.status_code, 200)
        self.assertEqual(duplicate.data['candidates'], [])

    def test_foreign_owner_company_tag_and_bulk_ids_are_rejected(self):
        foreign_tag = Tag.objects.create(organization=self.org_b, name='Foreign')
        company = self.client.patch(
            f'/api/v1/leads/{self.own_lead.id}/', {'company': self.foreign_company.id}, format='json'
        )
        owner = self.client.patch(
            f'/api/v1/leads/{self.own_lead.id}/', {'owner': self.user_b.id}, format='json'
        )
        tag = self.client.post(
            f'/api/v1/leads/{self.own_lead.id}/tags/', {'operation': 'attach', 'tag_ids': [foreign_tag.id]}, format='json'
        )
        bulk = self.client.post(
            '/api/v1/leads/bulk/',
            {'ids': [self.own_lead.id, self.foreign_lead.id], 'operation': 'archive'},
            format='json',
        )
        self.assertEqual(company.status_code, 400)
        self.assertEqual(owner.status_code, 400)
        self.assertEqual(tag.status_code, 400)
        self.assertEqual(bulk.status_code, 400)
        self.own_lead.refresh_from_db()
        self.foreign_lead.refresh_from_db()
        self.assertIsNone(self.own_lead.archived_at)
        self.assertIsNone(self.foreign_lead.archived_at)

    def test_archived_record_is_readable_but_not_mutable_until_restore(self):
        archived = self.client.post(f'/api/v1/leads/{self.own_lead.id}/archive/')
        self.assertEqual(archived.status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.get(f'/api/v1/leads/{self.own_lead.id}/').status_code, status.HTTP_200_OK)
        update = self.client.patch(
            f'/api/v1/leads/{self.own_lead.id}/', {'first_name': 'Bypass'}, format='json'
        )
        note = self.client.post(
            '/api/v1/notes/', {'lead': self.own_lead.id, 'body': 'Bypass'}, format='json'
        )
        self.assertEqual(update.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(note.status_code, status.HTTP_400_BAD_REQUEST)
        restored = self.client.post(f'/api/v1/leads/{self.own_lead.id}/restore/')
        self.assertEqual(restored.status_code, status.HTTP_200_OK)

    def test_archived_configuration_cannot_be_attached(self):
        tag = Tag.objects.create(organization=self.org_a, created_by=self.user_a, name='Retired')
        self.client.delete(f'/api/v1/tags/{tag.id}/')
        response = self.client.patch(
            f'/api/v1/leads/{self.own_lead.id}/', {'tags': [tag.id]}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(self.own_lead.tags.filter(pk=tag.id).exists())


class ConversionTransactionTests(APITestCase):
    def setUp(self):
        self.user, self.org = register_account(
            email='tx@example.com', password='StrongPass123!', first_name='Tx', organization_name='Tx Org'
        )
        self.client.force_authenticate(self.user)

    def test_contact_failure_rolls_back_company_and_lead(self):
        lead = Lead.objects.create(
            organization=self.org, created_by=self.user, first_name='Rollback', company_name='Transient Co'
        )
        with patch('apps.customer_core.conversion.Contact.objects.create', side_effect=IntegrityError('boom')):
            response = self.client.post(f'/api/v1/leads/{lead.id}/convert/', {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        lead.refresh_from_db()
        self.assertEqual(lead.status, Lead.Status.NEW)
        self.assertFalse(Company.objects.filter(organization=self.org, name='Transient Co').exists())

    def test_duplicate_conversion_requires_explicit_override_before_writes(self):
        Contact.objects.create(
            organization=self.org, created_by=self.user, first_name='Existing', email='same@example.com'
        )
        lead = Lead.objects.create(
            organization=self.org, created_by=self.user, first_name='Duplicate', email='same@example.com'
        )
        contact_count = Contact.objects.filter(organization=self.org).count()
        blocked = self.client.post(f'/api/v1/leads/{lead.id}/convert/', {}, format='json')
        self.assertEqual(blocked.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(blocked.data['duplicate_candidates'])
        lead.refresh_from_db()
        self.assertIsNone(lead.converted_at)
        self.assertEqual(Contact.objects.filter(organization=self.org).count(), contact_count)

        allowed = self.client.post(
            f'/api/v1/leads/{lead.id}/convert/', {'allow_duplicates': True}, format='json'
        )
        self.assertEqual(allowed.status_code, status.HTTP_200_OK, allowed.data)
        lead.refresh_from_db()
        self.assertIsNotNone(lead.converted_at)

    def test_existing_conversion_targets_receive_tags(self):
        tag = Tag.objects.create(organization=self.org, created_by=self.user, name='Priority')
        company = Company.objects.create(organization=self.org, created_by=self.user, name='Existing Company')
        contact = Contact.objects.create(organization=self.org, created_by=self.user, first_name='Existing')
        lead = Lead.objects.create(organization=self.org, created_by=self.user, first_name='Tagged')
        lead.tags.add(tag)
        response = self.client.post(
            f'/api/v1/leads/{lead.id}/convert/',
            {
                'existing_contact': contact.id,
                'create_contact': False,
                'existing_company': company.id,
                'create_company': False,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertTrue(contact.tags.filter(pk=tag.id).exists())
        self.assertTrue(company.tags.filter(pk=tag.id).exists())

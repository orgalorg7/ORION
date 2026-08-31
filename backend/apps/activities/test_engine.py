from datetime import date, datetime, time, timedelta
from unittest.mock import patch
from unittest import skipUnless
from threading import Barrier, Thread
from zoneinfo import ZoneInfo

from django.db import connection, connections
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, TransactionTestCase
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.contacts.models import Company, Contact
from apps.customer_core.models import CustomFieldDefinition, DomainEvent, Team
from apps.deals.models import Deal, Pipeline, Stage
from apps.leads.models import Lead
from apps.organizations.models import Membership
from apps.organizations.services import register_account

from .models import (
    Activity,
    ActivityAttendee,
    ActivityHistory,
    ActivityRecurrenceException,
    ActivityReminder,
    BusinessHoliday,
    BusinessHoursPolicy,
)
from .services import (
    ActivityVersionConflict,
    complete_activity,
    cancel_activity,
    dispatch_due_reminders,
    generate_series_occurrences,
    initialize_activity,
    reschedule_activity,
    start_activity,
    validate_recurrence_rule,
)
from .sla import add_business_minutes


class ActivityDomainUnitTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user, cls.org = register_account(
            email='unit@example.com', password='StrongPass123!', first_name='Unit', organization_name='Unit Org'
        )

    def test_timezone_instants_convert_without_changing_the_meeting(self):
        cairo = ZoneInfo('Africa/Cairo')
        scheduled = datetime(2026, 11, 10, 10, 0, tzinfo=cairo)
        self.assertEqual(scheduled.astimezone(ZoneInfo('Asia/Dubai')).hour, 12)
        self.assertEqual(scheduled.astimezone(ZoneInfo('America/New_York')).hour, 3)
        self.assertEqual(scheduled.astimezone(ZoneInfo('UTC')).hour, 8)

    def test_london_dst_weekly_recurrence_preserves_local_wall_time(self):
        start = datetime(2026, 3, 22, 10, 0, tzinfo=ZoneInfo('Europe/London'))
        rule = validate_recurrence_rule('FREQ=WEEKLY;COUNT=3', start)
        from dateutil.rrule import rrulestr

        values = list(rrulestr(rule, dtstart=start))
        self.assertEqual([item.hour for item in values], [10, 10, 10])
        self.assertNotEqual(values[0].utcoffset(), values[1].utcoffset())

        master = Activity.objects.create(
            organization=self.org, created_by=self.user, title='London weekly', due_at=start,
            scheduled_timezone='Europe/London', recurrence_rule='FREQ=WEEKLY;COUNT=3',
        )
        initialize_activity(master, self.user)
        generated = generate_series_occurrences(
            master.recurring_series, actor=self.user,
            through=datetime(2026, 4, 6, tzinfo=ZoneInfo('Europe/London')),
        )
        local_values = [item.due_at.astimezone(ZoneInfo('Europe/London')) for item in generated]
        self.assertEqual([item.hour for item in local_values], [10, 10])
        self.assertEqual([item.utcoffset() for item in local_values], [timedelta(hours=1), timedelta(hours=1)])

    def test_pathological_recurrence_is_rejected(self):
        start = timezone.now()
        with self.assertRaisesMessage(Exception, 'frequency'):
            validate_recurrence_rule('FREQ=SECONDLY', start)
        with self.assertRaisesMessage(Exception, '1,000'):
            validate_recurrence_rule('FREQ=DAILY;COUNT=1000000', start)

    def test_worker_command_runs_one_bounded_batch(self):
        with patch(
            'apps.activities.management.commands.process_activity_jobs.dispatch_due_reminders',
            return_value={'sent': 0, 'expired': 0, 'failed': 0},
        ) as reminders, patch(
            'apps.activities.management.commands.process_activity_jobs.generate_due_recurrences',
            return_value={'generated': 0, 'failed': 0},
        ) as recurrence:
            call_command('process_activity_jobs', '--once', batch_size=25)
        reminders.assert_called_once_with(batch_size=25)
        recurrence.assert_called_once_with(batch_size=25)

    def test_overdue_is_derived_and_cancelled_work_is_never_overdue(self):
        activity = Activity.objects.create(
            organization=self.org, created_by=self.user, title='Late', due_at=timezone.now() - timedelta(hours=2)
        )
        self.assertTrue(activity.is_overdue)
        activity.status = Activity.Status.CANCELLED
        activity.cancelled_at = timezone.now()
        activity.save()
        self.assertFalse(activity.is_overdue)

    def test_business_hours_sla_skips_weekend_and_holiday(self):
        policy = BusinessHoursPolicy.objects.get(organization=self.org, is_default=True)
        policy.timezone = 'Africa/Cairo'
        policy.workdays = [0, 1, 2, 3, 4]
        policy.opens_at = time(9)
        policy.closes_at = time(17)
        policy.save()
        BusinessHoliday.objects.create(
            organization=self.org, policy=policy, date=date(2026, 9, 7), label='Holiday'
        )
        start = datetime(2026, 9, 4, 16, 0, tzinfo=ZoneInfo('Africa/Cairo'))  # Friday
        result = add_business_minutes(start, 120, policy).astimezone(ZoneInfo('Africa/Cairo'))
        self.assertEqual(result, datetime(2026, 9, 8, 10, 0, tzinfo=ZoneInfo('Africa/Cairo')))

    def test_completion_is_idempotent_and_stale_version_conflicts(self):
        activity = Activity.objects.create(organization=self.org, created_by=self.user, title='Once')
        initialize_activity(activity, self.user)
        completed = complete_activity(activity, self.user, expected_version=1)
        again = complete_activity(completed, self.user, expected_version=1)
        self.assertEqual(completed.completed_at, again.completed_at)
        self.assertEqual(
            DomainEvent.objects.filter(organization=self.org, event_type='activity.completed').count(), 1
        )
        with self.assertRaises(ActivityVersionConflict):
            reschedule_activity(
                completed, self.user, due_at=timezone.now(), due_date=None,
                starts_at=None, ends_at=None, expected_version=1,
            )

    def test_start_is_an_idempotent_domain_transition(self):
        activity = Activity.objects.create(organization=self.org, created_by=self.user, title='Begin work')
        initialize_activity(activity, self.user)
        started = start_activity(activity, self.user, expected_version=1)
        retried = start_activity(started, self.user, expected_version=1)
        self.assertEqual(retried.status, Activity.Status.IN_PROGRESS)
        self.assertEqual(retried.actual_started_at, started.actual_started_at)
        self.assertEqual(ActivityHistory.objects.filter(activity=activity, event_type='started').count(), 1)

    def test_recurrence_generation_is_bounded_and_retry_safe(self):
        start = timezone.now() + timedelta(days=1)
        master = Activity.objects.create(
            organization=self.org, created_by=self.user, updated_by=self.user,
            title='Weekly review', due_at=start, scheduled_timezone='Africa/Cairo',
            recurrence_rule='FREQ=WEEKLY;COUNT=6',
        )
        initialize_activity(master, self.user, [{'offset_minutes': 60}])
        first = generate_series_occurrences(master.recurring_series, actor=self.user, through=start + timedelta(days=50))
        second = generate_series_occurrences(master.recurring_series, actor=self.user, through=start + timedelta(days=50))
        self.assertEqual(len(first), 5)
        self.assertEqual(second, [])
        self.assertEqual(master.recurring_series.occurrences.count(), 6)
        self.assertTrue(all(item.reminders.count() == 1 for item in first))

    def test_all_day_recurrence_preserves_local_dates(self):
        master = Activity.objects.create(
            organization=self.org, created_by=self.user, title='All-day review', all_day=True,
            due_date=date(2026, 9, 1), scheduled_timezone='Africa/Cairo',
            recurrence_rule='FREQ=DAILY;COUNT=3', assigned_to=self.user,
        )
        initialize_activity(master, self.user, [{'offset_minutes': 60}])
        generated = generate_series_occurrences(
            master.recurring_series, actor=self.user,
            through=datetime(2026, 9, 4, tzinfo=ZoneInfo('Africa/Cairo')),
        )
        self.assertEqual([item.due_date for item in generated], [date(2026, 9, 2), date(2026, 9, 3)])
        self.assertTrue(all(item.reminders.count() == 1 for item in generated))

    def test_rescheduling_one_occurrence_creates_exception(self):
        start = timezone.now() + timedelta(days=1)
        master = Activity.objects.create(
            organization=self.org, created_by=self.user, title='Weekly', due_at=start,
            recurrence_rule='FREQ=WEEKLY;COUNT=3',
        )
        initialize_activity(master, self.user)
        occurrence = generate_series_occurrences(
            master.recurring_series, actor=self.user, through=start + timedelta(days=20)
        )[0]
        moved = start + timedelta(days=8)
        reschedule_activity(
            occurrence, self.user, due_at=moved, due_date=None, starts_at=None, ends_at=None
        )
        exception = ActivityRecurrenceException.objects.get(series=master.recurring_series, original_occurrence_at=occurrence.occurrence_start)
        self.assertEqual(exception.action, ActivityRecurrenceException.Action.MODIFIED)
        self.assertEqual(exception.replacement_activity, occurrence)

    def test_reminder_handoff_is_once_only_and_suppresses_completed(self):
        activity = Activity.objects.create(
            organization=self.org, created_by=self.user, title='Reminder', due_at=timezone.now() + timedelta(hours=1),
            assigned_to=self.user,
        )
        initialize_activity(activity, self.user, [{'scheduled_for': timezone.now() - timedelta(minutes=5)}])
        self.assertEqual(dispatch_due_reminders()['sent'], 1)
        self.assertEqual(dispatch_due_reminders()['sent'], 0)
        self.assertEqual(DomainEvent.objects.filter(event_type='reminder.due').count(), 1)
        reminder = activity.reminders.get()
        self.assertEqual(reminder.status, ActivityReminder.Status.SENT)

        another = Activity.objects.create(
            organization=self.org, created_by=self.user, title='Done', due_at=timezone.now(), assigned_to=self.user,
        )
        initialize_activity(another, self.user, [{'scheduled_for': timezone.now() - timedelta(minutes=1)}])
        complete_activity(another, self.user)
        dispatch_due_reminders()
        self.assertEqual(another.reminders.get().status, ActivityReminder.Status.CANCELLED)

    def test_reminder_failure_is_observable_and_retryable(self):
        activity = Activity.objects.create(
            organization=self.org, created_by=self.user, title='Retry', due_at=timezone.now(), assigned_to=self.user,
        )
        initialize_activity(activity, self.user, [{'scheduled_for': timezone.now() - timedelta(minutes=1)}])
        with patch('apps.activities.services.record_activity_event', side_effect=RuntimeError('handoff down')):
            self.assertEqual(dispatch_due_reminders()['failed'], 1)
        reminder = activity.reminders.get()
        self.assertEqual(reminder.status, ActivityReminder.Status.FAILED)
        self.assertEqual(dispatch_due_reminders()['sent'], 1)


class ActivityApiIntegrationTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user_a, cls.org_a = register_account(
            email='alpha@example.com', password='StrongPass123!', first_name='Alpha', organization_name='Alpha Org'
        )
        cls.user_b, cls.org_b = register_account(
            email='bravo@example.com', password='StrongPass123!', first_name='Bravo', organization_name='Bravo Org'
        )
        cls.contact_a = Contact.objects.create(organization=cls.org_a, created_by=cls.user_a, first_name='Ahmed')
        cls.company_a = Company.objects.create(organization=cls.org_a, created_by=cls.user_a, name='Acme')
        pipeline = Pipeline.objects.get(organization=cls.org_a, is_default=True)
        stage = Stage.objects.filter(organization=cls.org_a, pipeline=pipeline, stage_type='open').first()
        cls.deal_a = Deal.objects.create(
            organization=cls.org_a, created_by=cls.user_a, title='Enterprise renewal', pipeline=pipeline, stage=stage
        )
        cls.foreign_contact = Contact.objects.create(
            organization=cls.org_b, created_by=cls.user_b, first_name='Private'
        )

    def setUp(self):
        self.client.force_authenticate(self.user_a)

    def create_task(self, **overrides):
        payload = {
            'type': 'task', 'title': 'Follow up with Acme', 'due_at': (timezone.now() + timedelta(days=1)).isoformat(),
            'contact': self.contact_a.id, 'company': self.company_a.id, 'deal': self.deal_a.id,
            'assigned_to': self.user_a.id,
            **overrides,
        }
        response = self.client.post('/api/v1/activities/', payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        return response

    def test_task_lifecycle_timeline_audit_and_next_activity_projection(self):
        created = self.create_task()
        activity_id = created.data['id']
        self.assertEqual(ActivityHistory.objects.filter(activity_id=activity_id, event_type='created').count(), 1)
        self.assertTrue(DomainEvent.objects.filter(event_type='deal.activity_created', object_id=self.deal_a.id).exists())

        started = self.client.post(f'/api/v1/activities/{activity_id}/start/', {
            'expected_version': created.data['version'],
        }, format='json')
        self.assertEqual(started.status_code, 200, started.data)
        self.assertEqual(started.data['status'], 'in_progress')

        detail = self.client.get(f'/api/v1/deals/{self.deal_a.id}/')
        self.assertEqual(detail.data['next_activity_id'], activity_id)
        self.assertEqual(detail.data['next_activity_title'], 'Follow up with Acme')

        rescheduled = self.client.post(f'/api/v1/activities/{activity_id}/reschedule/', {
            'due_at': (timezone.now() + timedelta(days=2)).isoformat(), 'reason': 'Customer requested later',
            'expected_version': started.data['version'],
        }, format='json')
        self.assertEqual(rescheduled.status_code, 200, rescheduled.data)
        snoozed = self.client.post(f'/api/v1/activities/{activity_id}/snooze/', {
            'until': (timezone.now() + timedelta(hours=3)).isoformat(),
            'expected_version': rescheduled.data['version'],
        }, format='json')
        self.assertEqual(snoozed.status_code, 200, snoozed.data)
        completed = self.client.post(f'/api/v1/activities/{activity_id}/complete/', {
            'expected_version': snoozed.data['version'], 'outcome': 'Proposal sent',
            'follow_up': {'title': 'Check proposal response', 'due_at': (timezone.now() + timedelta(days=3)).isoformat()},
        }, format='json')
        self.assertEqual(completed.status_code, 200, completed.data)
        self.assertEqual(completed.data['status'], 'completed')
        self.assertEqual(Activity.objects.filter(deal=self.deal_a).count(), 2)
        self.assertTrue(DomainEvent.objects.filter(event_type='activity.completed', object_id=activity_id).exists())

        reopened = self.client.post(f'/api/v1/activities/{activity_id}/reopen/', {
            'expected_version': completed.data['version'],
        }, format='json')
        self.assertEqual(reopened.status_code, 200, reopened.data)
        self.assertEqual(reopened.data['status'], 'open')
        self.assertTrue(ActivityHistory.objects.filter(activity_id=activity_id, event_type='reopened').exists())

    def test_related_record_owner_is_inherited_when_assignment_is_omitted(self):
        self.deal_a.owner = self.user_a
        self.deal_a.save(update_fields=['owner', 'updated_at'])
        response = self.client.post('/api/v1/activities/', {
            'type': 'follow_up', 'title': 'Inherited owner', 'deal': self.deal_a.id,
            'due_at': (timezone.now() + timedelta(days=1)).isoformat(),
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['assigned_to'], self.user_a.id)
        self.assertEqual(response.data['assigned_by'], self.user_a.id)

    def test_system_fields_cannot_be_mass_assigned(self):
        attempted_time = (timezone.now() - timedelta(days=5)).isoformat()
        response = self.client.post('/api/v1/activities/', {
            'type': 'call', 'title': 'Protected fields',
            'organization': self.org_b.id, 'source': 'integration',
            'completed_at': attempted_time, 'actual_started_at': attempted_time,
            'call_duration_seconds': 999, 'provider': 'forged-provider',
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        activity = Activity.objects.get(pk=response.data['id'])
        self.assertEqual(activity.organization_id, self.org_a.id)
        self.assertEqual(activity.source, Activity.Source.MANUAL)
        self.assertIsNone(activity.completed_at)
        self.assertIsNone(activity.actual_started_at)
        self.assertIsNone(activity.call_duration_seconds)
        self.assertEqual(activity.provider, '')

    def test_call_completion_uses_structured_outcome_and_duration(self):
        outcome = self.client.get('/api/v1/activity-outcomes/', {'category': 'call'}).data['results'][0]
        created = self.client.post('/api/v1/activities/', {
            'type': 'call', 'title': 'Discovery call', 'due_at': timezone.now().isoformat(),
            'call_direction': 'outbound', 'phone_number': '+201001234567',
        }, format='json')
        response = self.client.post(f"/api/v1/activities/{created.data['id']}/complete/", {
            'outcome_definition': outcome['id'], 'duration_seconds': 480,
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['outcome_key_snapshot'], outcome['key'])
        self.assertEqual(response.data['call_duration_seconds'], 480)

    def test_meeting_requires_valid_range_supports_attendees_and_warns_conflict(self):
        invalid = self.client.post('/api/v1/activities/', {
            'type': 'meeting', 'title': 'Backwards',
            'starts_at': (timezone.now() + timedelta(hours=2)).isoformat(),
            'ends_at': (timezone.now() + timedelta(hours=1)).isoformat(),
        }, format='json')
        self.assertEqual(invalid.status_code, 400)
        starts = timezone.now() + timedelta(days=1)
        first = self.client.post('/api/v1/activities/', {
            'type': 'meeting', 'title': 'Demo', 'starts_at': starts.isoformat(),
            'ends_at': (starts + timedelta(hours=1)).isoformat(), 'scheduled_timezone': 'Africa/Cairo',
            'assigned_to': self.user_a.id,
        }, format='json')
        self.assertEqual(first.status_code, 201, first.data)
        attendee = self.client.post(f"/api/v1/activities/{first.data['id']}/attendees/", {
            'contact': self.contact_a.id,
        }, format='json')
        self.assertEqual(attendee.status_code, 201, attendee.data)
        second = self.client.post('/api/v1/activities/', {
            'type': 'meeting', 'title': 'Overlap', 'starts_at': (starts + timedelta(minutes=30)).isoformat(),
            'ends_at': (starts + timedelta(minutes=90)).isoformat(), 'assigned_to': self.user_a.id,
        }, format='json')
        conflicts = self.client.get(f"/api/v1/activities/{second.data['id']}/conflicts/")
        self.assertEqual([item['id'] for item in conflicts.data], [first.data['id']])

    def test_all_day_date_and_calendar_bounds(self):
        created = self.client.post('/api/v1/activities/', {
            'type': 'task', 'title': 'All day', 'all_day': True, 'due_date': '2026-09-10',
            'scheduled_timezone': 'America/New_York', 'deal': self.deal_a.id,
        }, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        self.assertIsNone(created.data['due_at'])
        self.assertEqual(created.data['due_date'], '2026-09-10')
        valid = self.client.get('/api/v1/activities/calendar/', {
            'from': '2026-09-01T00:00:00Z', 'to': '2026-10-01T00:00:00Z',
        })
        self.assertEqual(valid.status_code, 200, valid.data)
        self.assertEqual(valid.data['count'], 1)
        deal = self.client.get(f'/api/v1/deals/{self.deal_a.id}/').data
        self.assertTrue(deal['next_activity_all_day'])
        self.assertEqual(deal['next_activity_due_date'], '2026-09-10')
        self.assertIsNone(deal['next_activity_at'])
        unbounded = self.client.get('/api/v1/activities/calendar/', {
            'from': '2020-01-01T00:00:00Z', 'to': '2030-01-01T00:00:00Z',
        })
        self.assertEqual(unbounded.status_code, 400)

    def test_reminder_action_rejects_unknown_channels(self):
        activity = self.create_task().data
        response = self.client.post(f"/api/v1/activities/{activity['id']}/reminders/", {
            'scheduled_for': (timezone.now() + timedelta(minutes=5)).isoformat(),
            'channel': 'carrier_pigeon',
        }, format='json')
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(ActivityReminder.objects.filter(activity_id=activity['id']).exists())

    def test_custom_fields_validate_and_filter(self):
        CustomFieldDefinition.objects.create(
            organization=self.org_a, created_by=self.user_a, target_object='activity', key='quality',
            label='Call quality', data_type='integer', required=True,
        )
        missing = self.client.post('/api/v1/activities/', {'type': 'task', 'title': 'Missing'}, format='json')
        self.assertEqual(missing.status_code, 400)
        created = self.client.post('/api/v1/activities/', {
            'type': 'task', 'title': 'Measured', 'custom_fields': {'quality': 8},
        }, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        result = self.client.get('/api/v1/activities/', {'custom__quality__gte': '7'})
        self.assertEqual(result.data['count'], 1)

    def test_search_filters_pagination_and_safe_sorting(self):
        for index in range(25):
            Activity.objects.create(
                organization=self.org_a, created_by=self.user_a, title=f'Arabic متابعة {index}',
                priority='high' if index % 2 else 'low',
            )
        response = self.client.get('/api/v1/activities/', {
            'search': 'متابعة', 'priority': 'high', 'page_size': 10, 'ordering': '-created_at',
        })
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['count'], 12)
        self.assertEqual(len(response.data['results']), 10)
        unsafe = self.client.get('/api/v1/activities/', {'ordering': 'title;DROP TABLE activities_activity'})
        self.assertEqual(unsafe.status_code, 200)
        self.assertEqual(Activity.objects.filter(organization=self.org_a).count(), 25)

    def test_bulk_actions_are_bounded_tenant_scoped_and_emit_history(self):
        ids = [Activity.objects.create(organization=self.org_a, created_by=self.user_a, title=f'Task {i}').id for i in range(3)]
        foreign = Activity.objects.create(organization=self.org_b, created_by=self.user_b, title='Foreign')
        denied = self.client.post('/api/v1/activities/bulk/', {'ids': [*ids, foreign.id], 'action': 'complete'}, format='json')
        self.assertEqual(denied.status_code, 400)
        self.assertEqual(Activity.objects.filter(id__in=ids, status='open').count(), 3)
        success = self.client.post('/api/v1/activities/bulk/', {'ids': ids, 'action': 'complete'}, format='json')
        self.assertEqual(success.status_code, 200, success.data)
        self.assertEqual(Activity.objects.filter(id__in=ids, status='completed').count(), 3)
        huge = self.client.post('/api/v1/activities/bulk/', {'ids': list(range(1, 502)), 'action': 'archive'}, format='json')
        self.assertEqual(huge.status_code, 400)

    def test_idempotency_key_returns_existing_activity(self):
        headers = {'HTTP_IDEMPOTENCY_KEY': 'automation-run-42'}
        first = self.client.post('/api/v1/activities/', {'title': 'Automated follow-up'}, format='json', **headers)
        second = self.client.post('/api/v1/activities/', {'title': 'Automated follow-up'}, format='json', **headers)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data['id'], second.data['id'])

    def test_editing_future_recurrence_splits_and_cancels_series_safely(self):
        start = timezone.now() + timedelta(days=1)
        created = self.client.post('/api/v1/activities/', {
            'type': 'task', 'title': 'Weekly pipeline review', 'due_at': start.isoformat(),
            'recurrence_rule': 'FREQ=WEEKLY;COUNT=8', 'scheduled_timezone': 'Africa/Cairo',
        }, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        original_series_id = created.data['recurring_series']
        split = self.client.post(
            f'/api/v1/activity-recurrence-series/{original_series_id}/edit-future/',
            {'effective_from': (start + timedelta(days=7)).isoformat(), 'rule': 'FREQ=WEEKLY;COUNT=4'},
            format='json',
        )
        self.assertEqual(split.status_code, 201, split.data)
        self.assertNotEqual(split.data['id'], original_series_id)
        self.assertFalse(Activity.objects.get(pk=created.data['id']).recurring_series.active)
        cancelled = self.client.post(
            f"/api/v1/activity-recurrence-series/{split.data['id']}/cancel/", {}, format='json'
        )
        self.assertEqual(cancelled.status_code, 200, cancelled.data)
        self.assertFalse(cancelled.data['active'])
        self.assertEqual(
            Activity.objects.get(pk=cancelled.data['template_activity']).status,
            Activity.Status.CANCELLED,
        )

    def test_activity_csv_import_and_formula_safe_export(self):
        upload = SimpleUploadedFile(
            'activities.csv',
            b'Type,Title,Due\r\ntask,Imported follow-up,2026-11-10T08:00:00Z\r\n',
            content_type='text/csv',
        )
        created = self.client.post('/api/v1/imports/', {
            'target_object': 'activity', 'source_file': upload,
        }, format='multipart')
        self.assertEqual(created.status_code, 201, created.data)
        processed = self.client.post(f"/api/v1/imports/{created.data['id']}/process/", {
            'mapping': {'Type': 'type', 'Title': 'title', 'Due': 'due_at'},
        }, format='json')
        self.assertEqual(processed.status_code, 200, processed.data)
        self.assertEqual(processed.data['report']['successful'], 1)
        imported = Activity.objects.get(title='Imported follow-up')
        self.assertEqual(imported.source, Activity.Source.IMPORT)

        Activity.objects.create(organization=self.org_a, created_by=self.user_a, title='=CMD(1)')
        exported = self.client.post('/api/v1/exports/', {
            'target_object': 'activity', 'fields': ['title', 'type'], 'sort': 'created_at',
        }, format='json')
        self.assertEqual(exported.status_code, 200)
        content = b''.join(exported.streaming_content).decode('utf-8')
        self.assertIn("'=CMD(1)", content)


class ActivityTenantSecurityTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user_a, cls.org_a = register_account(
            email='tenant-a@example.com', password='StrongPass123!', first_name='A', organization_name='Tenant A'
        )
        cls.user_b, cls.org_b = register_account(
            email='tenant-b@example.com', password='StrongPass123!', first_name='B', organization_name='Tenant B'
        )
        cls.foreign_activity = Activity.objects.create(
            organization=cls.org_b, created_by=cls.user_b, assigned_to=cls.user_b,
            title='Secret meeting', type='meeting', starts_at=timezone.now() + timedelta(days=1),
            ends_at=timezone.now() + timedelta(days=1, hours=1),
        )
        cls.foreign_recurring = Activity.objects.create(
            organization=cls.org_b, created_by=cls.user_b, assigned_to=cls.user_b,
            title='Secret recurring', due_at=timezone.now() + timedelta(days=1),
            recurrence_rule='FREQ=WEEKLY;COUNT=2',
        )
        initialize_activity(cls.foreign_recurring, cls.user_b)
        cls.foreign_contact = Contact.objects.create(organization=cls.org_b, created_by=cls.user_b, first_name='Secret')
        cls.foreign_company = Company.objects.create(organization=cls.org_b, created_by=cls.user_b, name='Secret Co')
        cls.foreign_lead = Lead.objects.create(organization=cls.org_b, created_by=cls.user_b, first_name='Secret')
        pipeline_b = Pipeline.objects.get(organization=cls.org_b, is_default=True)
        stage_b = Stage.objects.filter(organization=cls.org_b, pipeline=pipeline_b, stage_type='open').first()
        cls.foreign_deal = Deal.objects.create(
            organization=cls.org_b, created_by=cls.user_b, title='Secret deal', pipeline=pipeline_b, stage=stage_b
        )
        cls.team_b = Team.objects.create(organization=cls.org_b, created_by=cls.user_b, name='Private Team')

    def setUp(self):
        self.client.force_authenticate(self.user_a)

    def test_every_direct_idor_action_returns_not_found(self):
        activity_id = self.foreign_activity.id
        cases = [
            ('get', f'/api/v1/activities/{activity_id}/', None),
            ('patch', f'/api/v1/activities/{activity_id}/', {'title': 'Stolen'}),
            ('post', f'/api/v1/activities/{activity_id}/start/', {}),
            ('post', f'/api/v1/activities/{activity_id}/complete/', {}),
            ('post', f'/api/v1/activities/{activity_id}/cancel/', {}),
            ('post', f'/api/v1/activities/{activity_id}/reopen/', {}),
            ('post', f'/api/v1/activities/{activity_id}/reschedule/', {'due_at': timezone.now().isoformat()}),
            ('post', f'/api/v1/activities/{activity_id}/assign/', {'assigned_to': self.user_a.id}),
            ('post', f'/api/v1/activities/{activity_id}/attendees/', {'user': self.user_a.id}),
            ('delete', f'/api/v1/activities/{activity_id}/', None),
        ]
        for method, path, payload in cases:
            response = getattr(self.client, method)(path, payload or {}, format='json')
            self.assertEqual(response.status_code, 404, (method, path, response.data))

    def test_list_search_calendar_and_my_day_do_not_leak(self):
        self.assertEqual(self.client.get('/api/v1/activities/', {'search': 'Secret meeting'}).data['count'], 0)
        calendar = self.client.get('/api/v1/activities/calendar/', {
            'from': timezone.now().isoformat(), 'to': (timezone.now() + timedelta(days=3)).isoformat(),
        })
        self.assertEqual(calendar.data['count'], 0)
        payload = self.client.get('/api/v1/activities/my-day/').data
        self.assertEqual(payload['counts'], {'overdue': 0, 'today': 0, 'upcoming': 0})

    def test_my_day_uses_requested_timezone_boundaries(self):
        fixed_now = datetime(2026, 9, 1, 22, 30, tzinfo=ZoneInfo('UTC'))
        activity = Activity.objects.create(
            organization=self.org_a, created_by=self.user_a, assigned_to=self.user_a,
            title='Cairo morning', due_at=datetime(2026, 9, 2, 8, 0, tzinfo=ZoneInfo('UTC')),
        )
        with patch('apps.activities.views.timezone.now', return_value=fixed_now):
            cairo = self.client.get('/api/v1/activities/my-day/', {'timezone': 'Africa/Cairo'}).data
            new_york = self.client.get('/api/v1/activities/my-day/', {'timezone': 'America/New_York'}).data
        self.assertIn(activity.id, [item['id'] for item in cairo['today']])
        self.assertIn(activity.id, [item['id'] for item in new_york['upcoming']])

    def test_member_visibility_is_limited_to_own_team_shared_and_unassigned_work(self):
        member = get_user_model().objects.create_user(email='rep@example.com', password='StrongPass123!')
        Membership.objects.create(user=member, organization=self.org_a, role=Membership.Role.MEMBER)
        own = Activity.objects.create(
            organization=self.org_a, created_by=self.user_a, assigned_to=member, title='Mine'
        )
        private = Activity.objects.create(
            organization=self.org_a, created_by=self.user_a, assigned_to=self.user_a, title='Manager private',
            due_at=timezone.now() + timedelta(days=1), recurrence_rule='FREQ=WEEKLY;COUNT=2',
        )
        initialize_activity(private, self.user_a)
        self.client.force_authenticate(member)
        visible_ids = {item['id'] for item in self.client.get('/api/v1/activities/').data['results']}
        self.assertIn(own.id, visible_ids)
        self.assertNotIn(private.id, visible_ids)
        exported = self.client.post(
            '/api/v1/exports/', {'target_object': 'activity', 'fields': ['id', 'title']}, format='json'
        )
        self.assertEqual(exported.status_code, 200)
        export_body = b''.join(exported.streaming_content).decode('utf-8')
        self.assertIn('Mine', export_body)
        self.assertNotIn('Manager private', export_body)
        self.assertEqual(self.client.get(f'/api/v1/activities/{private.id}/').status_code, 404)
        self.assertEqual(self.client.post(f'/api/v1/activities/{private.id}/complete/', {}).status_code, 404)
        self.assertEqual(self.client.get(f'/api/v1/activity-recurrence-series/{private.recurring_series_id}/').status_code, 404)
        self.assertEqual(self.client.post(f'/api/v1/activity-recurrence-series/{private.recurring_series_id}/cancel/').status_code, 404)

    def test_foreign_relationship_owner_team_and_attendee_are_rejected(self):
        attempts = [
            {'title': 'Bad contact', 'contact': self.foreign_contact.id},
            {'title': 'Bad company', 'company': self.foreign_company.id},
            {'title': 'Bad lead', 'lead': self.foreign_lead.id},
            {'title': 'Bad deal', 'deal': self.foreign_deal.id},
            {'title': 'Bad owner', 'assigned_to': self.user_b.id},
            {'title': 'Bad team', 'team': self.team_b.id},
        ]
        for payload in attempts:
            response = self.client.post('/api/v1/activities/', payload, format='json')
            self.assertEqual(response.status_code, 400, (payload, response.data))
        own_meeting = Activity.objects.create(
            organization=self.org_a, created_by=self.user_a, title='Own', type='meeting',
            starts_at=timezone.now() + timedelta(days=1), ends_at=timezone.now() + timedelta(days=1, hours=1),
        )
        attendee = self.client.post(f'/api/v1/activities/{own_meeting.id}/attendees/', {
            'contact': self.foreign_contact.id,
        }, format='json')
        self.assertEqual(attendee.status_code, 400)
        self.assertFalse(ActivityAttendee.objects.exists())

    def test_duplicate_reminder_and_attendee_queries_are_tenant_scoped(self):
        ActivityReminder.objects.create(
            organization=self.org_b, activity=self.foreign_activity, recipient=self.user_b,
            scheduled_for=timezone.now() + timedelta(hours=1),
        )
        response = self.client.get(f'/api/v1/activities/{self.foreign_activity.id}/reminders/')
        self.assertEqual(response.status_code, 404)
        response = self.client.get(
            f'/api/v1/activity-recurrence-series/{self.foreign_recurring.recurring_series_id}/'
        )
        self.assertEqual(response.status_code, 404)


@skipUnless(connection.vendor == 'postgresql', 'PostgreSQL row-lock concurrency test')
class ActivityConcurrencyTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.user, self.org = register_account(
            email='race@example.com', password='StrongPass123!', first_name='Race', organization_name='Race Org'
        )

    def test_complete_and_cancel_race_cannot_corrupt_terminal_state(self):
        activity = Activity.objects.create(organization=self.org, created_by=self.user, title='Race')
        initialize_activity(activity, self.user)
        barrier = Barrier(2)
        outcomes = []

        def run(operation):
            connections.close_all()
            current = Activity.objects.select_related('organization').get(pk=activity.pk)
            actor = type(self.user).objects.get(pk=self.user.pk)
            barrier.wait()
            try:
                operation(current, actor)
                outcomes.append('committed')
            except Exception as exc:
                outcomes.append(type(exc).__name__)
            finally:
                connections.close_all()

        threads = [Thread(target=run, args=(complete_activity,)), Thread(target=run, args=(cancel_activity,))]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
        activity.refresh_from_db()
        self.assertIn(activity.status, (Activity.Status.COMPLETED, Activity.Status.CANCELLED))
        self.assertEqual(outcomes.count('committed'), 1)
        terminal_events = DomainEvent.objects.filter(
            organization=self.org, event_type__in=('activity.completed', 'activity.cancelled')
        )
        self.assertEqual(terminal_events.count(), 1)

    def test_concurrent_recurrence_generation_creates_each_occurrence_once(self):
        start = timezone.now() + timedelta(days=1)
        master = Activity.objects.create(
            organization=self.org, created_by=self.user, title='Concurrent weekly', due_at=start,
            recurrence_rule='FREQ=WEEKLY;COUNT=6',
        )
        initialize_activity(master, self.user)
        barrier = Barrier(2)
        counts = []

        def generate():
            connections.close_all()
            series = type(master.recurring_series).objects.select_related('organization').get(pk=master.recurring_series_id)
            actor = type(self.user).objects.get(pk=self.user.pk)
            barrier.wait()
            counts.append(len(generate_series_occurrences(series, actor=actor, through=start + timedelta(days=50))))
            connections.close_all()

        threads = [Thread(target=generate), Thread(target=generate)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
        self.assertEqual(sorted(counts), [0, 5])
        self.assertEqual(Activity.objects.filter(recurring_series=master.recurring_series).count(), 6)

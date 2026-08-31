import logging
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dateutil.rrule import rrulestr
from django.db import IntegrityError, connection, transaction
from django.db.models import F, Q
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import APIException

from apps.customer_core.events import record_event
from apps.customer_core.models import CustomFieldValue

from .models import (
    Activity,
    ActivityHistory,
    ActivityRecurrenceException,
    ActivityRecurrenceSeries,
    ActivityReminder,
)

logger = logging.getLogger(__name__)


class ActivityVersionConflict(APIException):
    status_code = 409
    default_code = 'version_conflict'
    default_detail = 'This activity changed after it was loaded. Refresh and try again.'


ACTIVE_STATUSES = (Activity.Status.OPEN, Activity.Status.IN_PROGRESS)
MAX_RECURRENCE_OCCURRENCES_PER_RUN = 500
MAX_RECURRENCE_HORIZON_DAYS = 93
REMINDER_GRACE = timedelta(hours=24)


def validate_timezone_name(value):
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError, TypeError) as exc:
        raise serializers.ValidationError('Use a valid IANA timezone, such as Africa/Cairo.') from exc
    return value


def validate_recurrence_rule(rule, dtstart):
    """Parse a bounded RFC 5545 rule and reject high-frequency/hostile input."""
    if not rule or len(rule) > 500:
        raise serializers.ValidationError('Enter an RRULE no longer than 500 characters.')
    normalized = rule.strip().upper()
    if normalized.startswith('RRULE:'):
        normalized = normalized[6:]
    parts = dict(
        item.split('=', 1) for item in normalized.split(';') if '=' in item
    )
    frequency = parts.get('FREQ')
    if frequency not in {'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'}:
        raise serializers.ValidationError('Recurrence frequency must be daily, weekly, monthly, or yearly.')
    try:
        interval = int(parts.get('INTERVAL', '1'))
        count = int(parts.get('COUNT', '0'))
    except ValueError as exc:
        raise serializers.ValidationError('RRULE interval and count must be whole numbers.') from exc
    if interval < 1 or interval > 366:
        raise serializers.ValidationError('RRULE interval must be between 1 and 366.')
    if count < 0 or count > 1000:
        raise serializers.ValidationError('RRULE count may not exceed 1,000 occurrences.')
    try:
        parsed = rrulestr(normalized, dtstart=dtstart)
        # A bounded probe catches malformed rules without expanding a series.
        list(parsed.between(dtstart, dtstart + timedelta(days=366 * 5), inc=True)[:2])
    except (ValueError, TypeError, OverflowError) as exc:
        raise serializers.ValidationError('Enter a valid RFC 5545 recurrence rule.') from exc
    return normalized


def _safe_value(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return value.isoformat() if hasattr(value, 'isoformat') else str(value)


def _activity_payload(activity, actor, **extra):
    return {
        'tenant_id': activity.organization_id,
        'activity_id': activity.id,
        'activity_type': activity.type,
        'owner_id': activity.assigned_to_id,
        'team_id': activity.team_id,
        'related_lead_id': activity.lead_id,
        'related_contact_id': activity.contact_id,
        'related_company_id': activity.company_id,
        'related_deal_id': activity.deal_id,
        'actor_id': getattr(actor, 'id', None),
        **{key: _safe_value(value) for key, value in extra.items()},
    }


def record_activity_event(activity, actor, event_type, *, changes=None, history_event=None, audit=True, **extra):
    now = timezone.now()
    payload = _activity_payload(activity, actor, **extra)
    record_event(
        organization=activity.organization,
        actor=actor,
        event_type=event_type,
        instance=activity,
        metadata=payload,
        field_diff=changes or {},
        audit=audit,
    )
    if history_event:
        ActivityHistory.objects.create(
            organization=activity.organization,
            created_by=actor,
            updated_by=actor,
            activity=activity,
            actor=actor,
            event_type=history_event,
            occurred_at=now,
            changes=changes or {},
        )
    suffix = event_type.split('.', 1)[-1]
    for target in (activity.lead, activity.contact, activity.company, activity.deal):
        if target is not None:
            record_event(
                organization=activity.organization,
                actor=actor,
                event_type=f'{target._meta.model_name}.activity_{suffix}',
                instance=target,
                metadata=payload,
                field_diff=changes or {},
                audit=False,
            )


def _lock_activity(activity, expected_version=None, include_archived=False):
    queryset = Activity.objects.select_for_update(of=('self',)).select_related(
        'organization', 'lead', 'contact', 'company', 'deal', 'outcome_definition'
    ).filter(organization=activity.organization, pk=activity.pk)
    if not include_archived:
        queryset = queryset.filter(archived_at__isnull=True)
    locked = queryset.first()
    if locked is None:
        raise serializers.ValidationError({'activity': 'Activity was not found.'})
    if expected_version is not None and locked.version != expected_version:
        raise ActivityVersionConflict()
    return locked


def _cancel_pending_reminders(activity, actor):
    now = timezone.now()
    changed = activity.reminders.filter(
        status__in=(
            ActivityReminder.Status.SCHEDULED, ActivityReminder.Status.PROCESSING,
            ActivityReminder.Status.FAILED,
        )
    ).update(status=ActivityReminder.Status.CANCELLED, updated_by=actor, updated_at=now)
    return changed


def _activity_reference(activity):
    """Return the recurrence/reminder anchor without losing all-day semantics."""
    reference = activity.starts_at or activity.due_at
    if reference is None and activity.all_day and activity.due_date:
        reference = datetime.combine(
            activity.due_date, time.min, tzinfo=ZoneInfo(activity.scheduled_timezone)
        ).astimezone(ZoneInfo('UTC'))
    return reference


@transaction.atomic
def initialize_activity(activity, actor, reminders=None):
    now = timezone.now()
    ActivityHistory.objects.create(
        organization=activity.organization, created_by=actor, updated_by=actor,
        activity=activity, actor=actor, event_type=ActivityHistory.Event.CREATED,
        occurred_at=now,
    )
    if activity.recurrence_rule:
        reference = _activity_reference(activity)
        if reference is None:
            raise serializers.ValidationError({'recurrence_rule': 'Recurring activities require a start, due time, or all-day date.'})
        rule = validate_recurrence_rule(activity.recurrence_rule, reference)
        series = ActivityRecurrenceSeries.objects.create(
            organization=activity.organization, created_by=actor, updated_by=actor,
            rule=rule, timezone=activity.scheduled_timezone, dtstart=reference,
            next_generation_at=timezone.now(), template_activity=activity,
        )
        activity.recurring_series = series
        activity.occurrence_start = reference
        activity.recurrence_rule = rule
        activity.save(update_fields=['recurring_series', 'occurrence_start', 'recurrence_rule', 'updated_at'])
    create_reminders(activity, actor, reminders or [])
    record_activity_event(activity, actor, 'activity.created', audit=True)
    record_activity_event(activity, actor, f'{activity.type}.created', audit=False)
    return activity


def create_reminders(activity, actor, reminders, *, validate_recipients=True):
    if len(reminders) > 10:
        raise serializers.ValidationError({'reminders': 'An activity may have at most 10 reminders.'})
    reference = activity.starts_at or activity.due_at
    if reference is None and activity.all_day and activity.due_date:
        reference = datetime.combine(
            activity.due_date, time(9), tzinfo=ZoneInfo(activity.scheduled_timezone)
        ).astimezone(ZoneInfo('UTC'))
    for item in reminders:
        scheduled_for = item.get('scheduled_for')
        offset = item.get('offset_minutes')
        try:
            offset = int(offset) if offset is not None else None
        except (TypeError, ValueError) as exc:
            raise serializers.ValidationError({'reminders': 'Reminder offsets must be whole minutes.'}) from exc
        if offset is not None and not 0 <= offset <= 525600:
            raise serializers.ValidationError({'reminders': 'Reminder offsets must be from 0 to 525,600 minutes.'})
        if scheduled_for is None and offset is not None and reference:
            scheduled_for = reference - timedelta(minutes=offset)
        if scheduled_for is None:
            raise serializers.ValidationError({'reminders': 'Each reminder needs a time or schedule offset.'})
        if not timezone.is_aware(scheduled_for):
            raise serializers.ValidationError({'reminders': 'Reminder timestamps must include a timezone.'})
        if activity.completed_at and scheduled_for >= activity.completed_at:
            raise serializers.ValidationError({'reminders': 'A reminder cannot be scheduled after completion.'})
        recipient = item.get('recipient') or activity.assigned_to or actor
        if recipient is None or (validate_recipients and not recipient.memberships.filter(
            organization=activity.organization, is_active=True
        ).exists()):
            raise serializers.ValidationError({'reminders': 'Reminder recipient must be an active workspace member.'})
        channel = item.get('channel', ActivityReminder.Channel.IN_APP)
        if channel not in ActivityReminder.Channel.values:
            raise serializers.ValidationError({'reminders': 'Unknown reminder channel.'})
        reminder, created = ActivityReminder.objects.get_or_create(
            activity=activity, recipient=recipient, channel=channel, scheduled_for=scheduled_for,
            defaults={
                'organization': activity.organization, 'created_by': actor, 'updated_by': actor,
                'offset_minutes': offset,
            },
        )
        if not created:
            continue
        record_activity_event(
            activity, actor, 'reminder.scheduled',
            reminder_id=reminder.id, scheduled_for=scheduled_for, channel=reminder.channel,
        )


@transaction.atomic
def complete_activity(activity, actor, *, outcome_definition=None, outcome='', duration_seconds=None,
                      expected_version=None, follow_up=None):
    # A network retry after commit must not fail only because its optimistic
    # version is now stale; completion itself is idempotent.
    locked = _lock_activity(activity)
    if locked.status == Activity.Status.COMPLETED:
        return locked
    if expected_version is not None and locked.version != expected_version:
        raise ActivityVersionConflict()
    if locked.status == Activity.Status.CANCELLED:
        raise serializers.ValidationError({'detail': 'Cannot complete a cancelled activity. Reopen it first.'})
    if outcome_definition:
        if outcome_definition.organization_id != locked.organization_id or not outcome_definition.active:
            raise serializers.ValidationError({'outcome_definition': 'Outcome is unavailable.'})
        expected_category = locked.type if locked.type in ('call', 'meeting') else 'general'
        if outcome_definition.category not in (expected_category, 'general'):
            raise serializers.ValidationError({'outcome_definition': 'Outcome is not valid for this activity type.'})
        locked.outcome_definition = outcome_definition
        locked.outcome_key_snapshot = outcome_definition.key
        locked.outcome_label_snapshot = outcome_definition.label
    if duration_seconds is not None:
        if locked.type != Activity.Type.CALL:
            raise serializers.ValidationError({'duration_seconds': 'Duration is only accepted for calls.'})
        if duration_seconds < 0 or duration_seconds > 86400:
            raise serializers.ValidationError({'duration_seconds': 'Call duration must be from 0 to 86,400 seconds.'})
        locked.call_duration_seconds = duration_seconds
    now = timezone.now()
    before = locked.status
    locked.status = Activity.Status.COMPLETED
    locked.completed_at = now
    locked.cancelled_at = None
    locked.outcome = outcome
    locked.snoozed_until = None
    locked.updated_by = actor
    locked.version = F('version') + 1
    locked.save(update_fields=[
        'status', 'completed_at', 'cancelled_at', 'outcome', 'outcome_definition',
        'outcome_key_snapshot', 'outcome_label_snapshot', 'call_duration_seconds',
        'snoozed_until', 'updated_by', 'version', 'updated_at',
    ])
    locked.refresh_from_db()
    _cancel_pending_reminders(locked, actor)
    changes = {'status': {'from': before, 'to': locked.status}, 'completed_at': {'from': None, 'to': now.isoformat()}}
    record_activity_event(
        locked, actor, 'activity.completed', changes=changes,
        history_event=ActivityHistory.Event.COMPLETED, completed_at=now,
    )
    record_activity_event(locked, actor, f'{locked.type}.completed', audit=False, completed_at=now)
    if follow_up:
        follow_up_activity = Activity.objects.create(
            organization=locked.organization, created_by=actor, updated_by=actor,
            assigned_by=actor, assigned_to=follow_up.get('assigned_to') or locked.assigned_to,
            team=locked.team, type=Activity.Type.FOLLOW_UP, title=follow_up['title'],
            description=follow_up.get('description', ''), due_at=follow_up.get('due_at'),
            scheduled_timezone=follow_up.get('scheduled_timezone', locked.scheduled_timezone),
            lead=locked.lead, contact=locked.contact, company=locked.company, deal=locked.deal,
        )
        initialize_activity(follow_up_activity, actor, follow_up.get('reminders'))
    return locked


@transaction.atomic
def start_activity(activity, actor, *, expected_version=None):
    locked = _lock_activity(activity)
    if locked.status == Activity.Status.IN_PROGRESS:
        return locked
    if locked.status != Activity.Status.OPEN:
        raise serializers.ValidationError({'detail': 'Only open activities can be started.'})
    if expected_version is not None and locked.version != expected_version:
        raise ActivityVersionConflict()
    now = timezone.now()
    locked.status = Activity.Status.IN_PROGRESS
    locked.actual_started_at = locked.actual_started_at or now
    locked.updated_by = actor
    locked.version = F('version') + 1
    locked.save(update_fields=['status', 'actual_started_at', 'updated_by', 'version', 'updated_at'])
    locked.refresh_from_db()
    record_activity_event(
        locked, actor, 'activity.started',
        changes={'status': {'from': Activity.Status.OPEN, 'to': Activity.Status.IN_PROGRESS}},
        history_event=ActivityHistory.Event.STARTED,
    )
    return locked


@transaction.atomic
def cancel_activity(activity, actor, *, reason='', expected_version=None):
    locked = _lock_activity(activity)
    if locked.status == Activity.Status.CANCELLED:
        return locked
    if expected_version is not None and locked.version != expected_version:
        raise ActivityVersionConflict()
    if locked.status == Activity.Status.COMPLETED:
        raise serializers.ValidationError({'detail': 'Cannot cancel a completed activity. Reopen it first.'})
    now = timezone.now()
    before = locked.status
    locked.status = Activity.Status.CANCELLED
    locked.cancelled_at = now
    locked.snoozed_until = None
    locked.updated_by = actor
    locked.version = F('version') + 1
    locked.save(update_fields=['status', 'cancelled_at', 'snoozed_until', 'updated_by', 'version', 'updated_at'])
    locked.refresh_from_db()
    _cancel_pending_reminders(locked, actor)
    changes = {'status': {'from': before, 'to': locked.status}, 'reason': reason[:500]}
    record_activity_event(locked, actor, 'activity.cancelled', changes=changes, history_event=ActivityHistory.Event.CANCELLED)
    return locked


@transaction.atomic
def reopen_activity(activity, actor, *, expected_version=None):
    locked = _lock_activity(activity, expected_version)
    if locked.status not in (Activity.Status.COMPLETED, Activity.Status.CANCELLED):
        raise serializers.ValidationError({'detail': 'Only completed or cancelled activities can be reopened.'})
    before = locked.status
    locked.status = Activity.Status.OPEN
    locked.completed_at = None
    locked.cancelled_at = None
    locked.updated_by = actor
    locked.version = F('version') + 1
    locked.save(update_fields=['status', 'completed_at', 'cancelled_at', 'updated_by', 'version', 'updated_at'])
    locked.refresh_from_db()
    record_activity_event(
        locked, actor, 'activity.reopened',
        changes={'status': {'from': before, 'to': locked.status}}, history_event=ActivityHistory.Event.REOPENED,
        previous_status=before,
    )
    return locked


@transaction.atomic
def reschedule_activity(activity, actor, *, due_at=None, due_date=None, starts_at=None, ends_at=None,
                        all_day=None, scheduled_timezone=None, reason='', expected_version=None):
    locked = _lock_activity(activity, expected_version)
    if locked.status not in ACTIVE_STATUSES:
        raise serializers.ValidationError({'detail': 'Only open activities can be rescheduled.'})
    if scheduled_timezone:
        validate_timezone_name(scheduled_timezone)
    target_all_day = locked.all_day if all_day is None else all_day
    if target_all_day and not due_date:
        raise serializers.ValidationError({'due_date': 'All-day activities require a calendar date.'})
    if locked.type == Activity.Type.MEETING and not target_all_day and (not starts_at or not ends_at):
        raise serializers.ValidationError({'starts_at': 'Meetings require a start and end time.'})
    if starts_at and ends_at and ends_at <= starts_at:
        raise serializers.ValidationError({'ends_at': 'Meeting end must be after its start.'})
    if target_all_day:
        due_at = starts_at = ends_at = None
    elif all_day is False:
        due_date = None
    before = {field: _safe_value(getattr(locked, field)) for field in (
        'due_at', 'due_date', 'all_day', 'starts_at', 'ends_at', 'scheduled_timezone'
    )}
    values = {
        'due_at': due_at, 'due_date': due_date, 'all_day': target_all_day,
        'starts_at': starts_at, 'ends_at': ends_at,
        'scheduled_timezone': scheduled_timezone or locked.scheduled_timezone,
    }
    for field, value in values.items():
        setattr(locked, field, value)
    locked.snoozed_until = None
    locked.updated_by = actor
    locked.version = F('version') + 1
    locked.save(update_fields=[*values, 'snoozed_until', 'updated_by', 'version', 'updated_at'])
    locked.refresh_from_db()
    after = {field: _safe_value(getattr(locked, field)) for field in before}
    changes = {field: {'from': before[field], 'to': after[field]} for field in before if before[field] != after[field]}
    if reason:
        changes['reason'] = reason[:500]
    # Pending offset reminders move with the schedule.
    reference = locked.starts_at or locked.due_at
    if reference is None and locked.all_day and locked.due_date:
        reference = datetime.combine(
            locked.due_date, time(9), tzinfo=ZoneInfo(locked.scheduled_timezone)
        ).astimezone(ZoneInfo('UTC'))
    if reference:
        for reminder in locked.reminders.filter(status=ActivityReminder.Status.SCHEDULED, offset_minutes__isnull=False):
            reminder.scheduled_for = reference - timedelta(minutes=reminder.offset_minutes)
            reminder.updated_by = actor
            reminder.save(update_fields=['scheduled_for', 'updated_by', 'updated_at'])
    record_activity_event(locked, actor, 'activity.rescheduled', changes=changes, history_event=ActivityHistory.Event.RESCHEDULED)
    if locked.recurring_series_id and locked.occurrence_start:
        ActivityRecurrenceException.objects.update_or_create(
            organization=locked.organization, series=locked.recurring_series,
            original_occurrence_at=locked.occurrence_start,
            defaults={
                'created_by': actor, 'updated_by': actor,
                'action': ActivityRecurrenceException.Action.MODIFIED,
                'replacement_activity': locked,
            },
        )
    return locked


@transaction.atomic
def snooze_activity(activity, actor, *, until, expected_version=None):
    locked = _lock_activity(activity, expected_version)
    if locked.status not in ACTIVE_STATUSES:
        raise serializers.ValidationError({'detail': 'Only open activities can be snoozed.'})
    if until <= timezone.now():
        raise serializers.ValidationError({'until': 'Snooze time must be in the future.'})
    before = locked.snoozed_until
    locked.snoozed_until = until
    locked.updated_by = actor
    locked.version = F('version') + 1
    locked.save(update_fields=['snoozed_until', 'updated_by', 'version', 'updated_at'])
    locked.refresh_from_db()
    locked.reminders.filter(status=ActivityReminder.Status.SCHEDULED, scheduled_for__lt=until).update(
        scheduled_for=until, updated_by=actor
    )
    record_activity_event(
        locked, actor, 'activity.snoozed',
        changes={'snoozed_until': {'from': _safe_value(before), 'to': until.isoformat()}},
        history_event=ActivityHistory.Event.SNOOZED,
    )
    return locked


@transaction.atomic
def assign_activity(activity, actor, *, assigned_to=None, team=None, expected_version=None):
    locked = _lock_activity(activity, expected_version)
    old_owner, old_team = locked.assigned_to_id, locked.team_id
    locked.assigned_to = assigned_to
    locked.team = team
    locked.assigned_by = actor
    locked.updated_by = actor
    locked.version = F('version') + 1
    locked.save(update_fields=['assigned_to', 'team', 'assigned_by', 'updated_by', 'version', 'updated_at'])
    locked.refresh_from_db()
    changes = {
        'owner_id': {'from': old_owner, 'to': locked.assigned_to_id},
        'team_id': {'from': old_team, 'to': locked.team_id},
    }
    record_activity_event(locked, actor, 'activity.assigned', changes=changes, history_event=ActivityHistory.Event.ASSIGNED)
    return locked


def _copy_occurrence(template, series, occurrence, actor, custom_values=None):
    reference = _activity_reference(template)
    delta = occurrence - reference
    data = {}
    for field in (
        'type', 'subtype', 'priority', 'title', 'description', 'internal_notes', 'scheduled_timezone',
        'assigned_to', 'assigned_by', 'team', 'contact', 'company', 'deal', 'lead', 'source', 'source_id',
        'call_direction', 'phone_number', 'location', 'meeting_url', 'sla_source',
    ):
        data[field] = getattr(template, field)
    data['starts_at'] = template.starts_at + delta if template.starts_at else None
    data['ends_at'] = template.ends_at + delta if template.ends_at else None
    data['due_at'] = template.due_at + delta if template.due_at else None
    if template.all_day:
        data['all_day'] = True
        data['due_date'] = occurrence.astimezone(ZoneInfo(series.timezone)).date()
    activity = Activity.objects.create(
        organization=series.organization, created_by=actor, updated_by=actor,
        recurring_series=series, recurrence_parent=template, occurrence_start=occurrence,
        **data,
    )
    # Unique values are intentionally occurrence-specific; reusable values
    # inherit from the series template without passing through untyped JSON.
    if custom_values is None:
        custom_values = list(CustomFieldValue.objects.filter(
            organization=series.organization, target_object='activity', object_id=template.id,
            definition__unique=False,
        ).select_related('definition'))
    CustomFieldValue.objects.bulk_create([
        CustomFieldValue(
            organization=series.organization, created_by=actor, updated_by=actor,
            definition=value.definition, target_object='activity', object_id=activity.id,
            text_value=value.text_value, number_value=value.number_value,
            boolean_value=value.boolean_value, date_value=value.date_value,
            datetime_value=value.datetime_value, json_value=value.json_value,
            normalized_value=value.normalized_value, unique_value=None,
        )
        for value in custom_values
    ])
    return activity


def _copy_offset_reminders(template, occurrence, actor, configs=None):
    """Absolute reminders are one-off; offset reminders belong to each occurrence."""
    if configs is None:
        configs = [
            {
                'offset_minutes': reminder.offset_minutes,
                'channel': reminder.channel,
                'recipient': reminder.recipient,
            }
            for reminder in template.reminders.filter(offset_minutes__isnull=False).select_related('recipient')[:10]
        ]
    if configs:
        create_reminders(occurrence, actor, configs, validate_recipients=False)


@transaction.atomic
def generate_series_occurrences(series, *, actor=None, through=None, limit=MAX_RECURRENCE_OCCURRENCES_PER_RUN):
    locked = ActivityRecurrenceSeries.objects.select_for_update(of=('self',)).select_related('template_activity').filter(
        pk=series.pk, organization=series.organization, active=True
    ).first()
    if not locked or not locked.template_activity:
        return []
    limit = min(max(1, int(limit)), MAX_RECURRENCE_OCCURRENCES_PER_RUN)
    through = min(through or timezone.now() + timedelta(days=MAX_RECURRENCE_HORIZON_DAYS),
                  timezone.now() + timedelta(days=MAX_RECURRENCE_HORIZON_DAYS))
    if locked.ended_at:
        through = min(through, locked.ended_at)
    if locked.generated_through and through <= locked.generated_through:
        return []
    local_dtstart = locked.dtstart.astimezone(ZoneInfo(locked.timezone))
    rule = rrulestr(validate_recurrence_rule(locked.rule, local_dtstart), dtstart=local_dtstart)
    start = locked.generated_through or locked.dtstart
    occurrences = rule.between(start, through, inc=locked.generated_through is None)
    exceptions = set(locked.exceptions.filter(
        original_occurrence_at__gte=start, original_occurrence_at__lte=through
    ).values_list('original_occurrence_at', flat=True))
    template_custom_values = list(CustomFieldValue.objects.filter(
        organization=locked.organization, target_object='activity', object_id=locked.template_activity_id,
        definition__unique=False,
    ).select_related('definition'))
    template_reminder_configs = [
        {
            'offset_minutes': reminder.offset_minutes,
            'channel': reminder.channel,
            'recipient': reminder.recipient,
        }
        for reminder in locked.template_activity.reminders.filter(
            offset_minutes__isnull=False
        ).select_related('recipient')[:10]
    ]
    created = []
    for occurrence in occurrences:
        if occurrence <= locked.dtstart or occurrence in exceptions:
            continue
        if len(created) >= limit:
            break
        try:
            with transaction.atomic():
                item = _copy_occurrence(
                    locked.template_activity, locked, occurrence, actor, template_custom_values
                )
                ActivityHistory.objects.create(
                    organization=locked.organization, created_by=actor, updated_by=actor,
                    activity=item, actor=actor, event_type=ActivityHistory.Event.CREATED,
                    occurred_at=timezone.now(), changes={'recurring_series_id': locked.id},
                )
                _copy_offset_reminders(
                    locked.template_activity, item, actor, template_reminder_configs
                )
                created.append(item)
        except IntegrityError:
            continue
    locked.generated_through = through
    locked.next_generation_at = through - timedelta(days=7)
    locked.updated_by = actor
    locked.save(update_fields=['generated_through', 'next_generation_at', 'updated_by', 'updated_at'])
    return created


@transaction.atomic
def edit_future_occurrences(series, actor, *, effective_from, rule):
    """Split a series so past/earlier occurrences keep their original rule."""
    locked = ActivityRecurrenceSeries.objects.select_for_update(of=('self',)).select_related('template_activity').filter(
        organization=series.organization, pk=series.pk, active=True
    ).first()
    if not locked or not locked.template_activity:
        raise serializers.ValidationError({'series': 'Recurring series is unavailable.'})
    now = timezone.now()
    if effective_from <= now or effective_from > now + timedelta(days=MAX_RECURRENCE_HORIZON_DAYS):
        raise serializers.ValidationError({
            'effective_from': f'Choose a future occurrence within {MAX_RECURRENCE_HORIZON_DAYS} days.'
        })
    new_rule = validate_recurrence_rule(rule, effective_from)
    generate_series_occurrences(locked, actor=actor, through=effective_from)
    future = list(locked.occurrences.select_for_update().filter(
        occurrence_start__gte=effective_from,
        status__in=(Activity.Status.OPEN, Activity.Status.IN_PROGRESS),
    )[:501])
    if len(future) > 500:
        raise serializers.ValidationError({'series': 'More than 500 generated occurrences require a background migration.'})
    for occurrence in future:
        cancel_occurrence(occurrence, actor)
    locked.active = False
    locked.ended_at = effective_from
    locked.updated_by = actor
    locked.version = F('version') + 1
    locked.save(update_fields=['active', 'ended_at', 'updated_by', 'version', 'updated_at'])
    new_series = ActivityRecurrenceSeries.objects.create(
        organization=locked.organization, created_by=actor, updated_by=actor,
        rule=new_rule, timezone=locked.timezone, dtstart=effective_from,
        next_generation_at=now,
    )
    template = _copy_occurrence(locked.template_activity, new_series, effective_from, actor)
    template.recurrence_rule = new_rule
    template.save(update_fields=['recurrence_rule', 'updated_at'])
    ActivityHistory.objects.create(
        organization=locked.organization, created_by=actor, updated_by=actor,
        activity=template, actor=actor, event_type=ActivityHistory.Event.CREATED,
        occurred_at=now, changes={'recurring_series_id': new_series.id},
    )
    _copy_offset_reminders(locked.template_activity, template, actor)
    new_series.template_activity = template
    new_series.save(update_fields=['template_activity', 'updated_at'])
    record_activity_event(
        template, actor, 'activity.recurrence_future_edited',
        old_series_id=locked.id, new_series_id=new_series.id, effective_from=effective_from,
    )
    return new_series


@transaction.atomic
def cancel_occurrence(activity, actor):
    if not activity.recurring_series_id or not activity.occurrence_start:
        raise serializers.ValidationError({'activity': 'This is not a recurring occurrence.'})
    ActivityRecurrenceException.objects.update_or_create(
        organization=activity.organization, series=activity.recurring_series,
        original_occurrence_at=activity.occurrence_start,
        defaults={'created_by': actor, 'updated_by': actor, 'action': ActivityRecurrenceException.Action.CANCELLED},
    )
    return cancel_activity(activity, actor, reason='Recurring occurrence cancelled')


def dispatch_due_reminders(*, now=None, batch_size=100):
    """DB-claimed, multi-replica-safe handoff to the future notification engine."""
    now = now or timezone.now()
    batch_size = min(max(1, int(batch_size)), 500)
    ids = list(ActivityReminder.objects.filter(
        status__in=(ActivityReminder.Status.SCHEDULED, ActivityReminder.Status.FAILED),
        attempt_count__lt=5,
        scheduled_for__lte=now,
    ).order_by('scheduled_for', 'id').values_list('id', flat=True)[:batch_size])
    sent = expired = failed = 0
    for reminder_id in ids:
        try:
            with transaction.atomic():
                query = ActivityReminder.objects.select_related('activity', 'activity__organization')
                if connection.features.has_select_for_update_skip_locked:
                    query = query.select_for_update(skip_locked=True)
                else:
                    query = query.select_for_update()
                reminder = query.filter(
                    pk=reminder_id,
                    status__in=(ActivityReminder.Status.SCHEDULED, ActivityReminder.Status.FAILED),
                    attempt_count__lt=5,
                ).first()
                if not reminder:
                    continue
                activity = reminder.activity
                if (activity.archived_at or activity.status in (Activity.Status.COMPLETED, Activity.Status.CANCELLED)
                        or (activity.snoozed_until and activity.snoozed_until > now)):
                    reminder.status = ActivityReminder.Status.CANCELLED
                    reminder.last_error = 'Activity is inactive or snoozed.'
                    reminder.save(update_fields=['status', 'last_error', 'updated_at'])
                    continue
                if reminder.scheduled_for < now - REMINDER_GRACE:
                    reminder.status = ActivityReminder.Status.CANCELLED
                    reminder.last_error = 'Expired outside the 24-hour delivery grace window.'
                    reminder.save(update_fields=['status', 'last_error', 'updated_at'])
                    expired += 1
                    continue
                reminder.status = ActivityReminder.Status.PROCESSING
                reminder.claimed_at = now
                reminder.attempt_count = F('attempt_count') + 1
                reminder.save(update_fields=['status', 'claimed_at', 'attempt_count', 'updated_at'])
                record_activity_event(
                    activity, None, 'reminder.due', audit=False,
                    reminder_id=reminder.id, user_id=reminder.recipient_id,
                    channel=reminder.channel, scheduled_for=reminder.scheduled_for,
                )
                reminder.status = ActivityReminder.Status.SENT
                reminder.sent_at = now
                reminder.last_error = ''
                reminder.save(update_fields=['status', 'sent_at', 'last_error', 'updated_at'])
                sent += 1
        except Exception as exc:  # failure state is observable and retryable by an operator
            failed += 1
            ActivityReminder.objects.filter(pk=reminder_id).update(
                status=ActivityReminder.Status.FAILED, failed_at=now,
                attempt_count=F('attempt_count') + 1, last_error=str(exc)[:500]
            )
    return {'sent': sent, 'expired': expired, 'failed': failed}


def generate_due_recurrences(*, now=None, batch_size=50):
    now = now or timezone.now()
    series_ids = list(ActivityRecurrenceSeries.objects.filter(
        active=True
    ).filter(Q(next_generation_at__isnull=True) | Q(next_generation_at__lte=now)).order_by('id').values_list('id', flat=True)[:batch_size])
    generated = failed = 0
    for series in ActivityRecurrenceSeries.objects.filter(pk__in=series_ids).select_related('organization'):
        try:
            generated += len(generate_series_occurrences(series, through=now + timedelta(days=MAX_RECURRENCE_HORIZON_DAYS)))
        except Exception:
            logger.exception('Activity recurrence generation failed', extra={'series_id': series.id})
            failed += 1
    return {'generated': generated, 'failed': failed}

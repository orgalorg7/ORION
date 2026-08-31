from datetime import datetime
from zoneinfo import ZoneInfo

from django.utils import timezone
from rest_framework import serializers

from apps.contacts.models import Company, Contact
from apps.core.fields import OrgMemberPrimaryKeyRelatedField, TenantPrimaryKeyRelatedField
from apps.core.serializers import UserBriefSerializer
from apps.customer_core.models import Team
from apps.customer_core.serializers import CustomerSerializerMixin, TeamBriefSerializer
from apps.deals.models import Deal
from apps.leads.models import Lead

from .models import (
    Activity,
    ActivityAttendee,
    ActivityHistory,
    ActivityOutcomeDefinition,
    ActivityRecurrenceException,
    ActivityRecurrenceSeries,
    ActivityReminder,
    BusinessHoliday,
    BusinessHoursPolicy,
    Note,
)
from .services import ActivityVersionConflict, validate_recurrence_rule, validate_timezone_name


class ContactBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contact
        fields = ['id', 'first_name', 'last_name', 'email', 'phone']
        read_only_fields = fields


class CompanyBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Company
        fields = ['id', 'name', 'domain']
        read_only_fields = fields


class DealBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Deal
        fields = ['id', 'title']
        read_only_fields = fields


class LeadBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lead
        fields = ['id', 'first_name', 'last_name', 'email', 'phone']
        read_only_fields = fields


class ActivityOutcomeDefinitionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityOutcomeDefinition
        fields = ['id', 'key', 'label', 'category', 'active', 'display_order', 'archived_at', 'created_at', 'updated_at']
        read_only_fields = ['id', 'archived_at', 'created_at', 'updated_at']

    def validate_key(self, value):
        return value.strip().casefold()

    def validate(self, attrs):
        if self.instance:
            for field in ('key', 'category'):
                if field in attrs and attrs[field] != getattr(self.instance, field):
                    raise serializers.ValidationError({field: 'Outcome semantic identity cannot be changed.'})
        return attrs


class ActivityAttendeeSerializer(serializers.ModelSerializer):
    response_status = serializers.ChoiceField(
        choices=['needs_action', 'accepted', 'declined', 'tentative'], required=False
    )
    user = OrgMemberPrimaryKeyRelatedField(required=False, allow_null=True)
    user_detail = UserBriefSerializer(source='user', read_only=True)
    contact = TenantPrimaryKeyRelatedField(queryset=Contact.objects.all(), required=False, allow_null=True)
    contact_detail = ContactBriefSerializer(source='contact', read_only=True)

    class Meta:
        model = ActivityAttendee
        fields = [
            'id', 'user', 'user_detail', 'contact', 'contact_detail', 'external_email',
            'display_name', 'response_status', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def validate(self, attrs):
        identities = [bool(attrs.get('user')), bool(attrs.get('contact')), bool(attrs.get('external_email'))]
        if sum(identities) != 1:
            raise serializers.ValidationError('Choose exactly one internal user, contact, or external email.')
        return attrs


class ActivityReminderSerializer(serializers.ModelSerializer):
    recipient_detail = UserBriefSerializer(source='recipient', read_only=True)

    class Meta:
        model = ActivityReminder
        fields = [
            'id', 'recipient', 'recipient_detail', 'channel', 'scheduled_for', 'offset_minutes',
            'status', 'attempt_count', 'sent_at', 'failed_at', 'last_error', 'created_at',
        ]
        read_only_fields = fields


class ActivityHistorySerializer(serializers.ModelSerializer):
    actor_detail = UserBriefSerializer(source='actor', read_only=True)

    class Meta:
        model = ActivityHistory
        fields = ['id', 'event_type', 'actor', 'actor_detail', 'occurred_at', 'changes']
        read_only_fields = fields


class ActivitySerializer(CustomerSerializerMixin, serializers.ModelSerializer):
    custom_target = 'activity'
    custom_fields = serializers.JSONField(required=False)
    description = serializers.CharField(required=False, allow_blank=True, max_length=10000)
    internal_notes = serializers.CharField(required=False, allow_blank=True, max_length=10000)
    assigned_to = OrgMemberPrimaryKeyRelatedField(required=False, allow_null=True)
    assigned_to_detail = UserBriefSerializer(source='assigned_to', read_only=True)
    owner = serializers.IntegerField(source='assigned_to_id', read_only=True)
    owner_detail = UserBriefSerializer(source='assigned_to', read_only=True)
    assigned_by_detail = UserBriefSerializer(source='assigned_by', read_only=True)
    team = TenantPrimaryKeyRelatedField(
        queryset=Team.objects.filter(active=True), required=False, allow_null=True
    )
    team_detail = TeamBriefSerializer(source='team', read_only=True)
    contact = TenantPrimaryKeyRelatedField(
        queryset=Contact.objects.filter(archived_at__isnull=True), required=False, allow_null=True
    )
    contact_detail = ContactBriefSerializer(source='contact', read_only=True)
    company = TenantPrimaryKeyRelatedField(
        queryset=Company.objects.filter(archived_at__isnull=True), required=False, allow_null=True
    )
    company_detail = CompanyBriefSerializer(source='company', read_only=True)
    deal = TenantPrimaryKeyRelatedField(
        queryset=Deal.objects.filter(archived_at__isnull=True), required=False, allow_null=True
    )
    deal_detail = DealBriefSerializer(source='deal', read_only=True)
    lead = TenantPrimaryKeyRelatedField(
        queryset=Lead.objects.filter(archived_at__isnull=True), required=False, allow_null=True
    )
    lead_detail = LeadBriefSerializer(source='lead', read_only=True)
    outcome_definition = serializers.PrimaryKeyRelatedField(read_only=True)
    outcome_definition_detail = ActivityOutcomeDefinitionSerializer(source='outcome_definition', read_only=True)
    attendees = serializers.SerializerMethodField()
    reminders = serializers.SerializerMethodField()
    reminder_configurations = serializers.ListField(child=serializers.DictField(), write_only=True, required=False)
    completed = serializers.BooleanField(read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)
    overdue_by_seconds = serializers.SerializerMethodField()
    duration_seconds = serializers.SerializerMethodField()
    expected_version = serializers.IntegerField(write_only=True, required=False, min_value=1)

    class Meta:
        model = Activity
        fields = [
            'id', 'type', 'subtype', 'status', 'priority', 'title', 'description', 'outcome',
            'internal_notes', 'outcome_definition', 'outcome_definition_detail',
            'outcome_key_snapshot', 'outcome_label_snapshot',
            'due_at', 'due_date', 'all_day', 'starts_at', 'ends_at', 'scheduled_timezone',
            'completed', 'completed_at', 'cancelled_at', 'snoozed_until',
            'actual_started_at', 'actual_ended_at', 'duration_seconds',
            'assigned_to', 'assigned_to_detail', 'owner', 'owner_detail', 'assigned_by', 'assigned_by_detail',
            'team', 'team_detail', 'contact', 'contact_detail', 'company', 'company_detail',
            'deal', 'deal_detail', 'lead', 'lead_detail', 'attendees', 'reminders', 'reminder_configurations',
            'recurring_series', 'recurrence_parent', 'recurrence_rule', 'occurrence_start',
            'source', 'source_id', 'version', 'archived_at',
            'expected_version',
            'call_direction', 'phone_number', 'call_duration_seconds', 'location', 'meeting_url',
            'provider', 'external_calendar_id', 'external_event_id', 'sync_state', 'last_synced_at', 'sync_version',
            'sla_deadline_at', 'sla_breached_at', 'sla_source', 'is_overdue', 'overdue_by_seconds',
            'is_sla_breached',
            'custom_fields', 'created_by', 'updated_by', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'status', 'completed_at', 'cancelled_at', 'assigned_by', 'recurring_series',
            'recurrence_parent', 'occurrence_start', 'source', 'source_id', 'version', 'archived_at',
            'actual_started_at', 'actual_ended_at', 'call_duration_seconds',
            'provider', 'external_calendar_id', 'external_event_id', 'sync_state', 'last_synced_at',
            'sync_version', 'sla_deadline_at', 'sla_breached_at', 'sla_source',
            'is_sla_breached',
            'outcome_key_snapshot', 'outcome_label_snapshot',
            'outcome', 'outcome_definition',
            'created_by', 'updated_by', 'created_at', 'updated_at',
        ]

    def get_overdue_by_seconds(self, obj):
        if not obj.is_overdue:
            return 0
        if obj.snoozed_until:
            return max(0, int((timezone.now() - obj.snoozed_until).total_seconds()))
        if obj.all_day and obj.due_date:
            local_today = timezone.now().astimezone(ZoneInfo(obj.scheduled_timezone)).date()
            return max(0, (local_today - obj.due_date).days * 86400)
        deadline = obj.due_at or obj.starts_at
        return max(0, int((timezone.now() - deadline).total_seconds())) if deadline else 0

    def get_duration_seconds(self, obj):
        if not obj.starts_at or not obj.ends_at:
            return None
        return int((obj.ends_at - obj.starts_at).total_seconds())

    def get_attendees(self, obj):
        if getattr(self.context.get('view'), 'action', None) != 'retrieve':
            return []
        return ActivityAttendeeSerializer(obj.attendees.all()[:100], many=True, context=self.context).data

    def get_reminders(self, obj):
        return ActivityReminderSerializer(obj.reminders.all()[:20], many=True, context=self.context).data

    def validate_scheduled_timezone(self, value):
        return validate_timezone_name(value)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        activity_type = attrs.get('type', getattr(self.instance, 'type', Activity.Type.TASK))
        all_day = attrs.get('all_day', getattr(self.instance, 'all_day', False))
        starts_at = attrs.get('starts_at', getattr(self.instance, 'starts_at', None))
        ends_at = attrs.get('ends_at', getattr(self.instance, 'ends_at', None))
        due_date = attrs.get('due_date', getattr(self.instance, 'due_date', None))
        due_at = attrs.get('due_at', getattr(self.instance, 'due_at', None))
        zone_name = attrs.get('scheduled_timezone', getattr(self.instance, 'scheduled_timezone', 'UTC'))
        validate_timezone_name(zone_name)

        if all_day:
            if not due_date:
                raise serializers.ValidationError({'due_date': 'All-day activities require a calendar date.'})
            attrs['due_at'] = None
        if activity_type == Activity.Type.MEETING and not all_day:
            if not starts_at or not ends_at:
                raise serializers.ValidationError({'starts_at': 'Meetings require a start and end time.'})
        if starts_at and ends_at and ends_at <= starts_at:
            raise serializers.ValidationError({'ends_at': 'Meeting end must be after its start.'})
        if activity_type != Activity.Type.CALL and attrs.get('call_direction'):
            raise serializers.ValidationError({'call_direction': 'Direction applies only to calls.'})
        if self.instance:
            if 'type' in attrs and attrs['type'] != self.instance.type:
                raise serializers.ValidationError({'type': 'Activity type cannot be changed after creation.'})
            schedule_fields = ('due_at', 'due_date', 'all_day', 'starts_at', 'ends_at', 'scheduled_timezone')
            changed = [field for field in schedule_fields if field in attrs and attrs[field] != getattr(self.instance, field)]
            if changed:
                raise serializers.ValidationError({changed[0]: 'Use the reschedule action to preserve schedule history.'})
            if 'recurrence_rule' in attrs and attrs['recurrence_rule'] != self.instance.recurrence_rule:
                raise serializers.ValidationError({'recurrence_rule': 'Use a recurrence series action to change this rule.'})
        recurrence_rule = attrs.get('recurrence_rule', '')
        if recurrence_rule:
            reference = starts_at or due_at
            if not reference:
                if all_day and due_date:
                    reference = datetime.combine(due_date, datetime.min.time(), tzinfo=ZoneInfo(zone_name))
                else:
                    raise serializers.ValidationError({'recurrence_rule': 'Recurring activities require a start or due time.'})
            attrs['recurrence_rule'] = validate_recurrence_rule(recurrence_rule, reference)
        reminder_configs = attrs.get('reminder_configurations', [])
        if len(reminder_configs) > 10:
            raise serializers.ValidationError({'reminder_configurations': 'At most 10 reminders are allowed.'})
        parsed_reminders = []
        for index, item in enumerate(reminder_configs):
            item = dict(item)
            if item.get('scheduled_for'):
                try:
                    item['scheduled_for'] = serializers.DateTimeField().run_validation(item['scheduled_for'])
                except serializers.ValidationError as exc:
                    raise serializers.ValidationError({'reminder_configurations': {index: exc.detail}}) from exc
            if item.get('offset_minutes') is not None:
                try:
                    item['offset_minutes'] = int(item['offset_minutes'])
                    if item['offset_minutes'] < 0 or item['offset_minutes'] > 525600:
                        raise ValueError
                except (TypeError, ValueError) as exc:
                    raise serializers.ValidationError({
                        'reminder_configurations': {index: 'Offset must be from 0 to 525,600 minutes.'}
                    }) from exc
            if item.get('channel', 'in_app') not in ActivityReminder.Channel.values:
                raise serializers.ValidationError({'reminder_configurations': {index: 'Unknown reminder channel.'}})
            parsed_reminders.append(item)
        if parsed_reminders:
            attrs['reminder_configurations'] = parsed_reminders
        if not any((attrs.get(field, getattr(self.instance, field, None)) for field in ('lead', 'contact', 'company', 'deal'))):
            # Internal work is valid, so this is intentionally not required.
            pass
        return attrs

    def create(self, validated_data):
        self._reminder_configurations = validated_data.pop('reminder_configurations', [])
        return super().create(validated_data)

    def update(self, instance, validated_data):
        expected_version = validated_data.pop('expected_version', None)
        validated_data.pop('reminder_configurations', None)
        locked = Activity.objects.select_for_update().get(organization=instance.organization, pk=instance.pk)
        if expected_version is not None and locked.version != expected_version:
            raise ActivityVersionConflict()
        return super().update(locked, validated_data)


class FollowUpCommandSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, max_length=5000)
    due_at = serializers.DateTimeField()
    scheduled_timezone = serializers.CharField(required=False, max_length=64)
    assigned_to = OrgMemberPrimaryKeyRelatedField(required=False, allow_null=True)

    def validate_scheduled_timezone(self, value):
        return validate_timezone_name(value)


class ActivityCompletionSerializer(serializers.Serializer):
    expected_version = serializers.IntegerField(required=False, min_value=1)
    outcome_definition = TenantPrimaryKeyRelatedField(
        queryset=ActivityOutcomeDefinition.objects.filter(active=True, archived_at__isnull=True),
        required=False, allow_null=True,
    )
    outcome = serializers.CharField(required=False, allow_blank=True, max_length=5000)
    duration_seconds = serializers.IntegerField(required=False, min_value=0, max_value=86400)
    follow_up = FollowUpCommandSerializer(required=False)


class ActivityCancellationSerializer(serializers.Serializer):
    expected_version = serializers.IntegerField(required=False, min_value=1)
    reason = serializers.CharField(required=False, allow_blank=True, max_length=500)


class ActivityVersionSerializer(serializers.Serializer):
    expected_version = serializers.IntegerField(required=False, min_value=1)


class ActivityRescheduleSerializer(ActivityVersionSerializer):
    due_at = serializers.DateTimeField(required=False, allow_null=True)
    due_date = serializers.DateField(required=False, allow_null=True)
    starts_at = serializers.DateTimeField(required=False, allow_null=True)
    ends_at = serializers.DateTimeField(required=False, allow_null=True)
    all_day = serializers.BooleanField(required=False)
    scheduled_timezone = serializers.CharField(required=False, max_length=64)
    reason = serializers.CharField(required=False, allow_blank=True, max_length=500)

    def validate(self, attrs):
        if not set(attrs) - {'expected_version', 'reason'}:
            raise serializers.ValidationError('Provide at least one schedule field.')
        if attrs.get('scheduled_timezone'):
            validate_timezone_name(attrs['scheduled_timezone'])
        if attrs.get('starts_at') and attrs.get('ends_at') and attrs['ends_at'] <= attrs['starts_at']:
            raise serializers.ValidationError({'ends_at': 'Meeting end must be after its start.'})
        return attrs


class ActivitySnoozeSerializer(ActivityVersionSerializer):
    until = serializers.DateTimeField()


class ActivityAssignSerializer(ActivityVersionSerializer):
    assigned_to = OrgMemberPrimaryKeyRelatedField(required=False, allow_null=True)
    team = TenantPrimaryKeyRelatedField(queryset=Team.objects.filter(active=True), required=False, allow_null=True)


class ActivityBulkSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.IntegerField(min_value=1), min_length=1, max_length=500)
    action = serializers.ChoiceField(choices=['complete', 'cancel', 'assign', 'priority', 'reschedule', 'archive', 'restore'])
    assigned_to = OrgMemberPrimaryKeyRelatedField(required=False, allow_null=True)
    team = TenantPrimaryKeyRelatedField(queryset=Team.objects.filter(active=True), required=False, allow_null=True)
    priority = serializers.ChoiceField(choices=Activity.Priority.choices, required=False)
    due_at = serializers.DateTimeField(required=False)
    reason = serializers.CharField(required=False, allow_blank=True, max_length=500)

    def validate(self, attrs):
        if attrs.get('action') == 'priority' and 'priority' not in attrs:
            raise serializers.ValidationError({'priority': 'Priority is required for this action.'})
        if attrs.get('action') == 'reschedule' and 'due_at' not in attrs:
            raise serializers.ValidationError({'due_at': 'Due time is required for this action.'})
        return attrs


class RecurrenceSeriesSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityRecurrenceSeries
        fields = [
            'id', 'rule', 'timezone', 'dtstart', 'template_activity', 'generated_through',
            'next_generation_at', 'active', 'ended_at', 'version', 'created_at', 'updated_at',
        ]
        read_only_fields = fields


class RecurrenceExceptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityRecurrenceException
        fields = ['id', 'series', 'original_occurrence_at', 'action', 'replacement_activity', 'created_at']
        read_only_fields = fields


class BusinessHolidaySerializer(serializers.ModelSerializer):
    class Meta:
        model = BusinessHoliday
        fields = ['id', 'date', 'label']
        read_only_fields = ['id']


class BusinessHoursPolicySerializer(serializers.ModelSerializer):
    holidays = BusinessHolidaySerializer(many=True, read_only=True)

    class Meta:
        model = BusinessHoursPolicy
        fields = ['id', 'name', 'timezone', 'workdays', 'opens_at', 'closes_at', 'active', 'is_default', 'holidays']
        read_only_fields = ['id']

    def validate_timezone(self, value):
        return validate_timezone_name(value)

    def validate_workdays(self, value):
        if not isinstance(value, list) or not value or len(value) > 7 or any(day not in range(7) for day in value):
            raise serializers.ValidationError('Use a non-empty unique list of weekday numbers from 0 to 6.')
        if len(value) != len(set(value)):
            raise serializers.ValidationError('Workdays must be unique.')
        return value


class NoteSerializer(serializers.ModelSerializer):
    body = serializers.CharField(max_length=20000)
    author_detail = UserBriefSerializer(source='author', read_only=True)
    contact = TenantPrimaryKeyRelatedField(queryset=Contact.objects.filter(archived_at__isnull=True), required=False, allow_null=True)
    company = TenantPrimaryKeyRelatedField(queryset=Company.objects.filter(archived_at__isnull=True), required=False, allow_null=True)
    deal = TenantPrimaryKeyRelatedField(queryset=Deal.objects.filter(archived_at__isnull=True), required=False, allow_null=True)
    lead = TenantPrimaryKeyRelatedField(queryset=Lead.objects.filter(archived_at__isnull=True), required=False, allow_null=True)

    class Meta:
        model = Note
        fields = ['id', 'body', 'author', 'author_detail', 'contact', 'company', 'deal', 'lead', 'archived_at', 'created_at', 'updated_at']
        read_only_fields = ['id', 'author', 'archived_at', 'created_at', 'updated_at']

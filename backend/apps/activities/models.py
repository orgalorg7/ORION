from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import TenantModel


class ActivityOutcomeDefinition(TenantModel):
    class Category(models.TextChoices):
        CALL = 'call', 'Call'
        MEETING = 'meeting', 'Meeting'
        GENERAL = 'general', 'General'

    key = models.SlugField(max_length=80)
    label = models.CharField(max_length=120)
    category = models.CharField(max_length=20, choices=Category.choices)
    active = models.BooleanField(default=True)
    display_order = models.PositiveSmallIntegerField(default=0)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['category', 'display_order', 'id']
        constraints = [models.UniqueConstraint(
            fields=['organization', 'category', 'key'], name='unique_activity_outcome_key'
        )]
        indexes = [models.Index(fields=['organization', 'category', 'active', 'display_order'])]


class ActivityRecurrenceSeries(TenantModel):
    """Bounded RFC 5545 recurrence definition; occurrences are generated lazily."""

    rule = models.CharField(max_length=500)
    timezone = models.CharField(max_length=64)
    dtstart = models.DateTimeField()
    template_activity = models.OneToOneField(
        'Activity', null=True, blank=True, on_delete=models.SET_NULL, related_name='template_for_series'
    )
    generated_through = models.DateTimeField(null=True, blank=True)
    next_generation_at = models.DateTimeField(null=True, blank=True)
    active = models.BooleanField(default=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ['next_generation_at', 'id']
        indexes = [
            models.Index(fields=['organization', 'active', 'next_generation_at']),
            models.Index(
                fields=['active', 'next_generation_at', 'id'],
                name='activity_series_due_idx',
            ),
        ]


class Activity(TenantModel):
    class Type(models.TextChoices):
        TASK = 'task', 'Task'
        CALL = 'call', 'Call'
        MEETING = 'meeting', 'Meeting'
        FOLLOW_UP = 'follow_up', 'Follow-up'
        REMINDER = 'reminder', 'Reminder'
        EMAIL = 'email', 'Email'

    class Status(models.TextChoices):
        OPEN = 'open', 'Open'
        IN_PROGRESS = 'in_progress', 'In progress'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'

    class Priority(models.TextChoices):
        LOW = 'low', 'Low'
        MEDIUM = 'medium', 'Medium'
        HIGH = 'high', 'High'
        URGENT = 'urgent', 'Urgent'

    class Source(models.TextChoices):
        MANUAL = 'manual', 'Manual'
        AUTOMATION = 'automation', 'Automation'
        IMPORT = 'import', 'Import'
        API = 'api', 'API'
        INTEGRATION = 'integration', 'Integration'
        AI_SUGGESTED = 'ai_suggested', 'AI suggested'
        SYSTEM = 'system', 'System'

    class CallDirection(models.TextChoices):
        INBOUND = 'inbound', 'Inbound'
        OUTBOUND = 'outbound', 'Outbound'

    class SyncState(models.TextChoices):
        LOCAL = 'local', 'Local only'
        PENDING = 'pending', 'Pending'
        SYNCED = 'synced', 'Synced'
        CONFLICT = 'conflict', 'Conflict'
        FAILED = 'failed', 'Failed'

    type = models.CharField(max_length=24, choices=Type.choices, default=Type.TASK)
    subtype = models.SlugField(max_length=80, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    priority = models.CharField(max_length=20, choices=Priority.choices, default=Priority.MEDIUM)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    outcome = models.TextField(blank=True)
    internal_notes = models.TextField(blank=True)
    outcome_definition = models.ForeignKey(
        ActivityOutcomeDefinition, null=True, blank=True, on_delete=models.PROTECT, related_name='activities'
    )
    outcome_key_snapshot = models.SlugField(max_length=80, blank=True)
    outcome_label_snapshot = models.CharField(max_length=120, blank=True)

    # Instants persist as UTC. All-day work uses a DateField and cannot shift timezone.
    due_at = models.DateTimeField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)
    all_day = models.BooleanField(default=False)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    scheduled_timezone = models.CharField(max_length=64, default='UTC')
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    snoozed_until = models.DateTimeField(null=True, blank=True)
    actual_started_at = models.DateTimeField(null=True, blank=True)
    actual_ended_at = models.DateTimeField(null=True, blank=True)

    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='assigned_activities',
    )
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='assigned_activity_actions',
    )
    team = models.ForeignKey(
        'customer_core.Team', null=True, blank=True, on_delete=models.SET_NULL, related_name='activities'
    )
    contact = models.ForeignKey(
        'contacts.Contact', null=True, blank=True, on_delete=models.SET_NULL, related_name='activities'
    )
    company = models.ForeignKey(
        'contacts.Company', null=True, blank=True, on_delete=models.SET_NULL, related_name='activities'
    )
    deal = models.ForeignKey(
        'deals.Deal', null=True, blank=True, on_delete=models.SET_NULL, related_name='activities'
    )
    lead = models.ForeignKey(
        'leads.Lead', null=True, blank=True, on_delete=models.SET_NULL, related_name='activities'
    )

    recurring_series = models.ForeignKey(
        ActivityRecurrenceSeries, null=True, blank=True, on_delete=models.SET_NULL, related_name='occurrences'
    )
    recurrence_parent = models.ForeignKey(
        'self', null=True, blank=True, on_delete=models.SET_NULL, related_name='recurrence_children'
    )
    recurrence_rule = models.CharField(max_length=500, blank=True)
    occurrence_start = models.DateTimeField(null=True, blank=True)

    source = models.CharField(max_length=24, choices=Source.choices, default=Source.MANUAL)
    source_id = models.CharField(max_length=160, blank=True)
    idempotency_key = models.CharField(max_length=160, blank=True)
    version = models.PositiveIntegerField(default=1)
    archived_at = models.DateTimeField(null=True, blank=True)

    call_direction = models.CharField(max_length=12, choices=CallDirection.choices, blank=True)
    phone_number = models.CharField(max_length=40, blank=True)
    call_duration_seconds = models.PositiveIntegerField(null=True, blank=True)
    location = models.CharField(max_length=255, blank=True)
    meeting_url = models.URLField(blank=True)
    provider = models.CharField(max_length=40, blank=True)
    external_calendar_id = models.CharField(max_length=255, blank=True)
    external_event_id = models.CharField(max_length=255, blank=True)
    sync_state = models.CharField(max_length=20, choices=SyncState.choices, default=SyncState.LOCAL)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    sync_version = models.CharField(max_length=120, blank=True)

    sla_deadline_at = models.DateTimeField(null=True, blank=True)
    sla_breached_at = models.DateTimeField(null=True, blank=True)
    sla_source = models.CharField(max_length=120, blank=True)

    class Meta:
        ordering = ['status', 'due_at', '-created_at', '-id']
        verbose_name_plural = 'activities'
        constraints = [
            models.CheckConstraint(
                condition=Q(ends_at__isnull=True) | Q(starts_at__isnull=True) | Q(ends_at__gt=models.F('starts_at')),
                name='activity_end_after_start',
            ),
            models.CheckConstraint(
                condition=Q(status='completed', completed_at__isnull=False) | ~Q(status='completed'),
                name='activity_completed_has_timestamp',
            ),
            models.CheckConstraint(
                condition=Q(status='cancelled', cancelled_at__isnull=False) | ~Q(status='cancelled'),
                name='activity_cancelled_has_timestamp',
            ),
            models.CheckConstraint(
                condition=Q(all_day=False) | Q(due_date__isnull=False), name='activity_all_day_has_date'
            ),
            models.UniqueConstraint(
                fields=['organization', 'idempotency_key'], condition=~Q(idempotency_key=''),
                name='unique_activity_idempotency',
            ),
            models.UniqueConstraint(
                fields=['recurring_series', 'occurrence_start'],
                condition=Q(recurring_series__isnull=False, occurrence_start__isnull=False),
                name='unique_series_occurrence',
            ),
        ]
        indexes = [
            models.Index(fields=['organization', 'assigned_to', 'status', 'due_at']),
            models.Index(
                fields=['organization', 'assigned_to', 'status', 'due_date'],
                name='act_org_owner_status_date_idx',
            ),
            models.Index(fields=['organization', 'team', 'status', 'due_at']),
            models.Index(fields=['organization', 'due_at', 'status']),
            models.Index(fields=['organization', 'due_date', 'status'], name='act_org_date_status_idx'),
            models.Index(fields=['organization', 'starts_at', 'ends_at']),
            models.Index(fields=['organization', 'type', 'status', '-created_at']),
            models.Index(fields=['organization', 'completed_at']),
            models.Index(fields=['organization', 'lead', 'status', 'due_at']),
            models.Index(fields=['organization', 'contact', 'status', 'due_at']),
            models.Index(fields=['organization', 'company', 'status', 'due_at']),
            models.Index(fields=['organization', 'deal', 'status', 'due_at']),
            models.Index(fields=['organization', 'archived_at', '-created_at']),
            models.Index(fields=['organization', 'sla_deadline_at', 'status'], name='act_org_sla_status_idx'),
        ]

    @property
    def completed(self):
        return self.status == self.Status.COMPLETED

    @property
    def is_overdue(self):
        from django.utils import timezone
        from zoneinfo import ZoneInfo
        if self.status in (self.Status.COMPLETED, self.Status.CANCELLED) or self.archived_at:
            return False
        if self.snoozed_until:
            return self.snoozed_until < timezone.now()
        if self.all_day and self.due_date:
            local_today = timezone.now().astimezone(ZoneInfo(self.scheduled_timezone)).date()
            return self.due_date < local_today
        deadline = self.due_at or self.starts_at
        return bool(deadline and deadline < timezone.now())

    @property
    def is_sla_breached(self):
        from django.utils import timezone
        if self.status in (self.Status.COMPLETED, self.Status.CANCELLED) or self.archived_at:
            return False
        return bool(self.sla_breached_at or (self.sla_deadline_at and self.sla_deadline_at < timezone.now()))

    def __str__(self):
        return self.title


class ActivityRecurrenceException(TenantModel):
    class Action(models.TextChoices):
        CANCELLED = 'cancelled', 'Cancelled'
        MODIFIED = 'modified', 'Modified'

    series = models.ForeignKey(ActivityRecurrenceSeries, on_delete=models.CASCADE, related_name='exceptions')
    original_occurrence_at = models.DateTimeField()
    action = models.CharField(max_length=16, choices=Action.choices)
    replacement_activity = models.ForeignKey(
        Activity, null=True, blank=True, on_delete=models.SET_NULL, related_name='recurrence_exception_for'
    )

    class Meta:
        constraints = [models.UniqueConstraint(
            fields=['series', 'original_occurrence_at'], name='unique_recurrence_exception'
        )]
        indexes = [models.Index(fields=['organization', 'series', 'original_occurrence_at'])]


class ActivityAttendee(TenantModel):
    activity = models.ForeignKey(Activity, on_delete=models.CASCADE, related_name='attendees')
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='activity_attendances',
    )
    contact = models.ForeignKey(
        'contacts.Contact', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='activity_attendances',
    )
    external_email = models.EmailField(blank=True)
    display_name = models.CharField(max_length=160, blank=True)
    response_status = models.CharField(max_length=24, default='needs_action')

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=(Q(user__isnull=False, contact__isnull=True, external_email='') |
                           Q(user__isnull=True, contact__isnull=False, external_email='') |
                           (Q(user__isnull=True, contact__isnull=True) & ~Q(external_email=''))),
                name='activity_attendee_one_identity',
            ),
            models.UniqueConstraint(fields=['activity', 'user'], condition=Q(user__isnull=False), name='unique_activity_user_attendee'),
            models.UniqueConstraint(fields=['activity', 'contact'], condition=Q(contact__isnull=False), name='unique_activity_contact_attendee'),
            models.UniqueConstraint(fields=['activity', 'external_email'], condition=~Q(external_email=''), name='unique_activity_email_attendee'),
        ]
        indexes = [models.Index(fields=['organization', 'activity'])]


class ActivityReminder(TenantModel):
    class Channel(models.TextChoices):
        IN_APP = 'in_app', 'In-app'
        EMAIL = 'email', 'Email'
        PUSH = 'push', 'Push'
        WHATSAPP = 'whatsapp', 'WhatsApp'

    class Status(models.TextChoices):
        SCHEDULED = 'scheduled', 'Scheduled'
        PROCESSING = 'processing', 'Processing'
        SENT = 'sent', 'Sent'
        FAILED = 'failed', 'Failed'
        CANCELLED = 'cancelled', 'Cancelled'

    activity = models.ForeignKey(Activity, on_delete=models.CASCADE, related_name='reminders')
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='activity_reminders')
    channel = models.CharField(max_length=16, choices=Channel.choices, default=Channel.IN_APP)
    scheduled_for = models.DateTimeField()
    offset_minutes = models.PositiveIntegerField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.SCHEDULED)
    claimed_at = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    failed_at = models.DateTimeField(null=True, blank=True)
    attempt_count = models.PositiveSmallIntegerField(default=0)
    last_error = models.CharField(max_length=500, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(
            fields=['activity', 'recipient', 'channel', 'scheduled_for'], name='unique_activity_reminder'
        )]
        indexes = [
            models.Index(fields=['status', 'scheduled_for']),
            models.Index(fields=['organization', 'recipient', 'status', 'scheduled_for']),
        ]


class ActivityHistory(TenantModel):
    class Event(models.TextChoices):
        CREATED = 'created', 'Created'
        ASSIGNED = 'assigned', 'Assigned'
        STARTED = 'started', 'Started'
        RESCHEDULED = 'rescheduled', 'Rescheduled'
        SNOOZED = 'snoozed', 'Snoozed'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'
        REOPENED = 'reopened', 'Reopened'
        ARCHIVED = 'archived', 'Archived'
        RESTORED = 'restored', 'Restored'

    activity = models.ForeignKey(Activity, on_delete=models.CASCADE, related_name='history')
    event_type = models.CharField(max_length=24, choices=Event.choices)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='activity_history'
    )
    occurred_at = models.DateTimeField()
    changes = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-occurred_at', '-id']
        indexes = [
            models.Index(fields=['organization', 'activity', '-occurred_at']),
            models.Index(fields=['organization', 'event_type', '-occurred_at']),
        ]


class BusinessHoursPolicy(TenantModel):
    name = models.CharField(max_length=120)
    timezone = models.CharField(max_length=64)
    workdays = models.JSONField(default=list)
    opens_at = models.TimeField()
    closes_at = models.TimeField()
    active = models.BooleanField(default=True)
    is_default = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(closes_at__gt=models.F('opens_at')), name='business_hours_valid_range'),
            models.UniqueConstraint(fields=['organization'], condition=Q(is_default=True, active=True), name='one_default_business_policy'),
        ]


class BusinessHoliday(TenantModel):
    policy = models.ForeignKey(BusinessHoursPolicy, on_delete=models.CASCADE, related_name='holidays')
    date = models.DateField()
    label = models.CharField(max_length=120, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['policy', 'date'], name='unique_business_holiday')]


class Note(TenantModel):
    body = models.TextField()
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='notes'
    )
    contact = models.ForeignKey('contacts.Contact', null=True, blank=True, on_delete=models.CASCADE, related_name='notes')
    company = models.ForeignKey('contacts.Company', null=True, blank=True, on_delete=models.CASCADE, related_name='notes')
    deal = models.ForeignKey('deals.Deal', null=True, blank=True, on_delete=models.CASCADE, related_name='notes')
    lead = models.ForeignKey('leads.Lead', null=True, blank=True, on_delete=models.CASCADE, related_name='notes')
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [models.Index(fields=['organization', 'archived_at', '-created_at'])]

    def __str__(self):
        return self.body[:50]

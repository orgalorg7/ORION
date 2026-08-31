from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import django_filters
from django.db import transaction
from django.db.models import Avg, Count, DurationField, ExpressionWrapper, F, Q
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import IsOrgMember
from apps.core.utils import get_membership
from apps.core.viewsets import TenantViewSet
from apps.customer_core.events import record_event
from apps.customer_core.mixins import CustomerRecordViewSetMixin

from .models import (
    Activity,
    ActivityAttendee,
    ActivityHistory,
    ActivityOutcomeDefinition,
    ActivityRecurrenceSeries,
    ActivityReminder,
    BusinessHoursPolicy,
    Note,
)
from .permissions import ActivityConfigurationPermission, ActivityPermission
from .serializers import (
    ActivityAssignSerializer,
    ActivityAttendeeSerializer,
    ActivityBulkSerializer,
    ActivityCancellationSerializer,
    ActivityCompletionSerializer,
    ActivityHistorySerializer,
    ActivityOutcomeDefinitionSerializer,
    ActivityReminderSerializer,
    ActivityRescheduleSerializer,
    ActivitySerializer,
    ActivitySnoozeSerializer,
    ActivityVersionSerializer,
    BusinessHoursPolicySerializer,
    NoteSerializer,
    RecurrenceSeriesSerializer,
)
from .services import (
    assign_activity,
    cancel_activity,
    cancel_occurrence,
    complete_activity,
    create_reminders,
    edit_future_occurrences,
    generate_series_occurrences,
    initialize_activity,
    record_activity_event,
    reopen_activity,
    reschedule_activity,
    snooze_activity,
    start_activity,
    validate_timezone_name,
)


class NumberInFilter(django_filters.BaseInFilter, django_filters.NumberFilter):
    pass


class ActivityFilterSet(django_filters.FilterSet):
    completed = django_filters.BooleanFilter(method='filter_completed')
    due_before = django_filters.IsoDateTimeFilter(field_name='due_at', lookup_expr='lte')
    due_after = django_filters.IsoDateTimeFilter(field_name='due_at', lookup_expr='gte')
    starts_before = django_filters.IsoDateTimeFilter(field_name='starts_at', lookup_expr='lte')
    starts_after = django_filters.IsoDateTimeFilter(field_name='starts_at', lookup_expr='gte')
    created_after = django_filters.IsoDateTimeFilter(field_name='created_at', lookup_expr='gte')
    completed_after = django_filters.IsoDateTimeFilter(field_name='completed_at', lookup_expr='gte')
    completed_before = django_filters.IsoDateTimeFilter(field_name='completed_at', lookup_expr='lte')
    overdue = django_filters.BooleanFilter(method='filter_overdue')
    recurring = django_filters.BooleanFilter(method='filter_recurring')
    has_reminder = django_filters.BooleanFilter(method='filter_has_reminder')
    ids = NumberInFilter(field_name='id', lookup_expr='in')

    class Meta:
        model = Activity
        fields = [
            'type', 'status', 'priority', 'assigned_to', 'team', 'contact', 'company', 'deal', 'lead',
            'source', 'all_day', 'ids',
        ]

    def filter_completed(self, queryset, name, value):
        return queryset.filter(status=Activity.Status.COMPLETED) if value else queryset.exclude(
            status__in=(Activity.Status.COMPLETED, Activity.Status.CANCELLED)
        )

    def filter_overdue(self, queryset, name, value):
        if not value:
            return queryset
        now = timezone.now()
        zone_name = self.request.query_params.get('timezone', 'UTC') if self.request else 'UTC'
        validate_timezone_name(zone_name)
        today = now.astimezone(ZoneInfo(zone_name)).date()
        return queryset.filter(
            status__in=(Activity.Status.OPEN, Activity.Status.IN_PROGRESS), archived_at__isnull=True
        ).filter(
            Q(all_day=False, snoozed_until__isnull=True, due_at__lt=now) |
            Q(all_day=False, snoozed_until__isnull=True, due_at__isnull=True, starts_at__lt=now) |
            Q(all_day=False, snoozed_until__lt=now) |
            Q(all_day=True, due_date__lt=today)
        )

    def filter_recurring(self, queryset, name, value):
        return queryset.filter(recurring_series__isnull=not value)

    def filter_has_reminder(self, queryset, name, value):
        lookup = queryset.filter(reminders__isnull=False) if value else queryset.filter(reminders__isnull=True)
        return lookup.distinct()


class ActivityViewSet(CustomerRecordViewSetMixin, TenantViewSet):
    queryset = Activity.objects.all()
    serializer_class = ActivitySerializer
    permission_classes = [IsAuthenticated, IsOrgMember, ActivityPermission]
    custom_target = 'activity'
    event_prefix = 'activity'
    filterset_class = ActivityFilterSet
    search_fields = [
        'title', 'contact__display_name', 'contact__normalized_name',
        'company__name', 'company__normalized_name', 'deal__title', 'deal__normalized_title',
        'lead__display_name', 'lead__normalized_name', 'assigned_to__first_name', 'assigned_to__last_name',
    ]
    ordering_fields = ['due_at', 'due_date', 'starts_at', 'created_at', 'updated_at', 'completed_at', 'priority', 'title']
    ordering = ['status', 'due_at', '-created_at', '-id']
    bulk_limit = 500

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            'assigned_to', 'assigned_by', 'team', 'contact', 'company', 'deal', 'lead', 'outcome_definition'
        )
        queryset = queryset.prefetch_related('reminders')
        if getattr(self, 'action', None) == 'retrieve':
            queryset = queryset.prefetch_related('attendees__user', 'attendees__contact')
        membership = get_membership(self.request)
        if membership and membership.role not in ('owner', 'admin', 'manager'):
            queryset = queryset.filter(
                Q(assigned_to=self.request.user) |
                Q(assigned_to__isnull=True, team__isnull=True) |
                Q(team__members=self.request.user) |
                Q(attendees__user=self.request.user)
            ).distinct()
        return queryset

    def create(self, request, *args, **kwargs):
        key = request.headers.get('Idempotency-Key', '').strip()[:160]
        if key:
            existing = self.get_queryset().filter(idempotency_key=key).first()
            if existing:
                return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
        with transaction.atomic():
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            related = next((
                serializer.validated_data.get(field)
                for field in ('deal', 'lead', 'contact', 'company')
                if serializer.validated_data.get(field) is not None
            ), None)
            inherited_owner = getattr(related, 'owner', None) if related is not None else None
            inherited_team = getattr(related, 'team', None) if related is not None else None
            save_kwargs = {
                'organization': self.org, 'created_by': request.user, 'updated_by': request.user,
                'idempotency_key': key,
            }
            if 'assigned_to' not in serializer.validated_data and inherited_owner is not None:
                save_kwargs['assigned_to'] = inherited_owner
            if 'team' not in serializer.validated_data and inherited_team is not None:
                save_kwargs['team'] = inherited_team
            resolved_owner = serializer.validated_data.get('assigned_to', inherited_owner)
            if resolved_owner is not None:
                save_kwargs['assigned_by'] = request.user
            activity = serializer.save(
                **save_kwargs,
            )
            initialize_activity(activity, request.user, getattr(serializer, '_reminder_configurations', []))
        return Response(self.get_serializer(activity).data, status=status.HTTP_201_CREATED)

    @transaction.atomic
    def perform_update(self, serializer):
        instance = serializer.instance
        before = {
            field: getattr(instance, field)
            for field in ('title', 'description', 'priority', 'assigned_to_id', 'team_id', 'contact_id', 'company_id', 'deal_id', 'lead_id')
        }
        serializer.save(updated_by=self.request.user)
        after = {field: getattr(instance, field) for field in before}
        changes = {
            field: {'from': before[field], 'to': after[field]}
            for field in before if before[field] != after[field]
        }
        if changes:
            ownership_changed = 'assigned_to_id' in changes or 'team_id' in changes
            if ownership_changed:
                instance.assigned_by = self.request.user
                instance.save(update_fields=['assigned_by', 'updated_at'])
            instance.version = F('version') + 1
            instance.save(update_fields=['version', 'updated_at'])
            instance.refresh_from_db()
            record_activity_event(instance, self.request.user, 'activity.updated', changes=changes)
            if ownership_changed:
                record_activity_event(
                    instance, self.request.user, 'activity.assigned', changes=changes,
                    history_event=ActivityHistory.Event.ASSIGNED,
                )

    def destroy(self, request, *args, **kwargs):
        return self.archive(request, kwargs.get('pk'))

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def archive(self, request, pk=None):
        activity = self.get_object()
        if activity.archived_at is None:
            activity.archived_at = timezone.now()
            activity.updated_by = request.user
            activity.version = F('version') + 1
            activity.save(update_fields=['archived_at', 'updated_by', 'version', 'updated_at'])
            activity.reminders.filter(status__in=(
                ActivityReminder.Status.SCHEDULED, ActivityReminder.Status.PROCESSING,
                ActivityReminder.Status.FAILED,
            )).update(
                status=ActivityReminder.Status.CANCELLED, updated_by=request.user
            )
            activity.refresh_from_db()
            record_activity_event(activity, request.user, 'activity.archived', history_event=ActivityHistory.Event.ARCHIVED)
        return Response(self.get_serializer(activity).data)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def restore(self, request, pk=None):
        activity = Activity.objects.select_for_update().filter(organization=self.org, pk=pk).first()
        if activity is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        self.check_object_permissions(request, activity)
        if activity.archived_at:
            activity.archived_at = None
            activity.updated_by = request.user
            activity.version = F('version') + 1
            activity.save(update_fields=['archived_at', 'updated_by', 'version', 'updated_at'])
            activity.refresh_from_db()
            record_activity_event(activity, request.user, 'activity.restored', history_event=ActivityHistory.Event.RESTORED)
        return Response(self.get_serializer(activity).data)

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        activity = self.get_object()
        # Compatibility with Module 01's completion checkbox: false is now an explicit reopen.
        if request.data.get('completed') is False:
            payload = ActivityVersionSerializer(data=request.data)
            payload.is_valid(raise_exception=True)
            result = reopen_activity(activity, request.user, **payload.validated_data)
        else:
            payload = ActivityCompletionSerializer(data=request.data, context=self.get_serializer_context())
            payload.is_valid(raise_exception=True)
            result = complete_activity(activity, request.user, **payload.validated_data)
        return Response(self.get_serializer(result).data)

    @action(detail=True, methods=['post'])
    def start(self, request, pk=None):
        payload = ActivityVersionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        result = start_activity(self.get_object(), request.user, **payload.validated_data)
        return Response(self.get_serializer(result).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        payload = ActivityCancellationSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        result = cancel_activity(self.get_object(), request.user, **payload.validated_data)
        return Response(self.get_serializer(result).data)

    @action(detail=True, methods=['post'])
    def reopen(self, request, pk=None):
        payload = ActivityVersionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        result = reopen_activity(self.get_object(), request.user, **payload.validated_data)
        return Response(self.get_serializer(result).data)

    @action(detail=True, methods=['post'])
    def reschedule(self, request, pk=None):
        payload = ActivityRescheduleSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        activity = self.get_object()
        values = {
            'due_at': payload.validated_data.pop('due_at', activity.due_at),
            'due_date': payload.validated_data.pop('due_date', activity.due_date),
            'starts_at': payload.validated_data.pop('starts_at', activity.starts_at),
            'ends_at': payload.validated_data.pop('ends_at', activity.ends_at),
            'all_day': payload.validated_data.pop('all_day', activity.all_day),
            **payload.validated_data,
        }
        result = reschedule_activity(activity, request.user, **values)
        return Response(self.get_serializer(result).data)

    @action(detail=True, methods=['post'])
    def snooze(self, request, pk=None):
        payload = ActivitySnoozeSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        result = snooze_activity(self.get_object(), request.user, **payload.validated_data)
        return Response(self.get_serializer(result).data)

    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        payload = ActivityAssignSerializer(data=request.data, context=self.get_serializer_context())
        payload.is_valid(raise_exception=True)
        result = assign_activity(self.get_object(), request.user, **payload.validated_data)
        return Response(self.get_serializer(result).data)

    @action(detail=True, methods=['get', 'post', 'delete'])
    def attendees(self, request, pk=None):
        activity = self.get_object()
        if activity.type != Activity.Type.MEETING:
            raise serializers.ValidationError({'detail': 'Attendees are supported on meetings.'})
        if request.method == 'GET':
            queryset = activity.attendees.select_related('user', 'contact').order_by('id')
            page = self.paginate_queryset(queryset)
            data = ActivityAttendeeSerializer(page, many=True, context=self.get_serializer_context()).data
            return self.get_paginated_response(data)
        if request.method == 'DELETE':
            attendee = activity.attendees.filter(pk=request.data.get('attendee_id')).first()
            if not attendee:
                return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
            attendee.delete()
            record_activity_event(activity, request.user, 'activity.attendee_removed', attendee_id=request.data.get('attendee_id'))
            return Response(status=status.HTTP_204_NO_CONTENT)
        payload = ActivityAttendeeSerializer(data=request.data, context=self.get_serializer_context())
        payload.is_valid(raise_exception=True)
        if activity.attendees.count() >= 500:
            raise serializers.ValidationError({'detail': 'A meeting may have at most 500 attendees.'})
        attendee = payload.save(
            organization=self.org, activity=activity, created_by=request.user, updated_by=request.user
        )
        record_activity_event(activity, request.user, 'activity.attendee_added', attendee_id=attendee.id)
        return Response(ActivityAttendeeSerializer(attendee, context=self.get_serializer_context()).data, status=201)

    @action(detail=True, methods=['get', 'post', 'delete'])
    def reminders(self, request, pk=None):
        activity = self.get_object()
        if request.method == 'GET':
            queryset = activity.reminders.select_related('recipient').order_by('scheduled_for', 'id')
            page = self.paginate_queryset(queryset)
            return self.get_paginated_response(ActivityReminderSerializer(page, many=True).data)
        if request.method == 'DELETE':
            with transaction.atomic():
                reminder = activity.reminders.select_for_update().filter(
                    pk=request.data.get('reminder_id')
                ).first()
                if not reminder:
                    return Response({'detail': 'Not found.'}, status=404)
                if reminder.status in (ActivityReminder.Status.SENT, ActivityReminder.Status.CANCELLED):
                    raise serializers.ValidationError({'detail': 'This reminder is no longer cancellable.'})
                reminder.status = ActivityReminder.Status.CANCELLED
                reminder.updated_by = request.user
                reminder.save(update_fields=['status', 'updated_by', 'updated_at'])
                record_activity_event(activity, request.user, 'reminder.cancelled', reminder_id=reminder.id)
            return Response(status=204)
        if activity.status not in (Activity.Status.OPEN, Activity.Status.IN_PROGRESS):
            raise serializers.ValidationError({'detail': 'Reminders require an open activity.'})
        if activity.reminders.count() >= 10:
            raise serializers.ValidationError({'detail': 'An activity may have at most 10 reminders.'})
        field = serializers.DateTimeField()
        raw_time = request.data.get('scheduled_for')
        scheduled_for = field.run_validation(raw_time) if raw_time else None
        offset = request.data.get('offset_minutes')
        if offset is not None:
            try:
                offset = int(offset)
            except (TypeError, ValueError) as exc:
                raise serializers.ValidationError({'offset_minutes': 'Use a whole number.'}) from exc
        with transaction.atomic():
            create_reminders(activity, request.user, [{
                'scheduled_for': scheduled_for, 'offset_minutes': offset,
                'channel': request.data.get('channel', 'in_app'), 'recipient': activity.assigned_to or request.user,
            }])
        activity.refresh_from_db()
        reminder = activity.reminders.order_by('-id').first()
        return Response(ActivityReminderSerializer(reminder).data, status=201)

    @action(detail=True, methods=['get'])
    def history(self, request, pk=None):
        activity = self.get_object()
        queryset = activity.history.select_related('actor')
        page = self.paginate_queryset(queryset)
        serializer = ActivityHistorySerializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @action(detail=True, methods=['post'], url_path='cancel-occurrence')
    def cancel_occurrence_action(self, request, pk=None):
        result = cancel_occurrence(self.get_object(), request.user)
        return Response(self.get_serializer(result).data)

    @action(detail=True, methods=['get'])
    def conflicts(self, request, pk=None):
        activity = self.get_object()
        if not activity.starts_at or not activity.ends_at:
            return Response([])
        user_ids = set(activity.attendees.filter(user__isnull=False).values_list('user_id', flat=True))
        if activity.assigned_to_id:
            user_ids.add(activity.assigned_to_id)
        conflicts = self.get_queryset().filter(
            type=Activity.Type.MEETING, status__in=(Activity.Status.OPEN, Activity.Status.IN_PROGRESS),
            starts_at__lt=activity.ends_at, ends_at__gt=activity.starts_at,
        ).exclude(pk=activity.pk).filter(Q(assigned_to_id__in=user_ids) | Q(attendees__user_id__in=user_ids)).distinct()
        return Response(self.get_serializer(conflicts[:100], many=True).data)

    @action(detail=False, methods=['get'], url_path='calendar')
    def calendar(self, request):
        query = serializers.Serializer(data=request.query_params)
        query.fields['from'] = serializers.DateTimeField()
        query.fields['to'] = serializers.DateTimeField()
        query.fields['timezone'] = serializers.CharField(required=False, default='UTC', max_length=64)
        query.is_valid(raise_exception=True)
        start, end = query.validated_data['from'], query.validated_data['to']
        zone_name = validate_timezone_name(query.validated_data['timezone'])
        local_zone = ZoneInfo(zone_name)
        if end <= start or end - start > timedelta(days=93):
            raise serializers.ValidationError({'to': 'Calendar ranges must be positive and no longer than 93 days.'})
        local_start_date = start.astimezone(local_zone).date()
        local_end_date = end.astimezone(local_zone).date()
        queryset = self.filter_queryset(self.get_queryset()).filter(
            Q(starts_at__lt=end, ends_at__gt=start) |
            Q(starts_at__isnull=True, due_at__gte=start, due_at__lt=end) |
            Q(all_day=True, due_date__gte=local_start_date, due_date__lt=local_end_date)
        ).order_by('starts_at', 'due_at', 'id')
        page = self.paginate_queryset(queryset)
        return self.get_paginated_response(self.get_serializer(page, many=True).data)

    @action(detail=False, methods=['get'], url_path='my-day')
    def my_day(self, request):
        membership = get_membership(request)
        now = timezone.now()
        zone_name = validate_timezone_name(request.query_params.get('timezone', 'UTC'))
        local_zone = ZoneInfo(zone_name)
        local_today = now.astimezone(local_zone).date()
        tomorrow = local_today + timedelta(days=1)
        start = datetime.combine(local_today, time.min, tzinfo=local_zone).astimezone(ZoneInfo('UTC'))
        end = datetime.combine(tomorrow, time.min, tzinfo=local_zone).astimezone(ZoneInfo('UTC'))
        team_scope = membership.role in ('owner', 'admin', 'manager') and request.query_params.get('scope') == 'team'
        base = self.filter_queryset(self.get_queryset())
        if not team_scope:
            base = base.filter(assigned_to=request.user)
        open_work = base.filter(status__in=(Activity.Status.OPEN, Activity.Status.IN_PROGRESS))
        overdue_filter = (
            Q(snoozed_until__lt=now) |
            Q(snoozed_until__isnull=True, all_day=True, due_date__lt=local_today) |
            Q(snoozed_until__isnull=True, all_day=False, due_at__lt=now) |
            Q(snoozed_until__isnull=True, all_day=False, due_at__isnull=True, starts_at__lt=now)
        )
        today_filter = (
            Q(snoozed_until__gte=now, snoozed_until__lt=end) |
            Q(snoozed_until__isnull=True, all_day=True, due_date=local_today) |
            Q(snoozed_until__isnull=True, all_day=False, due_at__gte=start, due_at__lt=end) |
            Q(snoozed_until__isnull=True, all_day=False, due_at__isnull=True, starts_at__gte=start, starts_at__lt=end)
        )
        upcoming_filter = (
            Q(snoozed_until__gte=end) |
            Q(snoozed_until__isnull=True, all_day=True, due_date__gte=tomorrow) |
            Q(snoozed_until__isnull=True, all_day=False, due_at__gte=end) |
            Q(snoozed_until__isnull=True, all_day=False, due_at__isnull=True, starts_at__gte=end)
        )
        counts = open_work.aggregate(
            overdue=Count('id', filter=overdue_filter),
            today=Count('id', filter=today_filter),
            upcoming=Count('id', filter=upcoming_filter),
        )
        overdue = open_work.filter(overdue_filter).order_by('due_at', 'id')[:50]
        today = open_work.filter(today_filter).order_by('starts_at', 'due_at', 'id')[:50]
        upcoming = open_work.filter(upcoming_filter).order_by('starts_at', 'due_at', 'id')[:50]
        serialize = lambda items: self.get_serializer(items, many=True).data
        return Response({
            'timezone': zone_name,
            'scope': 'team' if team_scope else 'mine',
            'overdue': serialize(overdue), 'today': serialize(today), 'upcoming': serialize(upcoming),
            'counts': counts,
        })

    @action(detail=False, methods=['get'])
    def analytics(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        now = timezone.now()
        zone_name = validate_timezone_name(request.query_params.get('timezone', 'UTC'))
        local_today = now.astimezone(ZoneInfo(zone_name)).date()
        overdue_filter = Q(status__in=(Activity.Status.OPEN, Activity.Status.IN_PROGRESS)) & (
            Q(snoozed_until__lt=now)
            | Q(snoozed_until__isnull=True, all_day=True, due_date__lt=local_today)
            | Q(snoozed_until__isnull=True, all_day=False, due_at__lt=now)
            | Q(snoozed_until__isnull=True, all_day=False, due_at__isnull=True, starts_at__lt=now)
        )
        duration = ExpressionWrapper(F('completed_at') - F('created_at'), output_field=DurationField())
        totals = queryset.aggregate(
            created=Count('id'), completed=Count('id', filter=Q(status=Activity.Status.COMPLETED)),
            overdue=Count('id', filter=overdue_filter),
            average_completion_time=Avg(duration, filter=Q(status=Activity.Status.COMPLETED)),
            calls_completed=Count('id', filter=Q(type=Activity.Type.CALL, status=Activity.Status.COMPLETED)),
            meetings_completed=Count('id', filter=Q(type=Activity.Type.MEETING, status=Activity.Status.COMPLETED)),
            follow_ups_due=Count('id', filter=Q(type=Activity.Type.FOLLOW_UP, status__in=(Activity.Status.OPEN, Activity.Status.IN_PROGRESS))),
        )
        created = totals['created'] or 0
        totals['completion_rate'] = round((totals['completed'] or 0) * 100 / created, 2) if created else 0
        if totals['average_completion_time']:
            totals['average_completion_seconds'] = int(totals.pop('average_completion_time').total_seconds())
        else:
            totals.pop('average_completion_time')
            totals['average_completion_seconds'] = None
        totals['by_owner'] = list(queryset.values('assigned_to_id').annotate(total=Count('id'), completed=Count('id', filter=Q(status='completed'))).order_by('-total')[:100])
        totals['by_team'] = list(queryset.values('team_id').annotate(
            total=Count('id'), completed=Count('id', filter=Q(status='completed'))
        ).order_by('-total')[:100])
        totals['by_deal'] = list(queryset.exclude(deal_id=None).values('deal_id').annotate(
            total=Count('id'), completed=Count('id', filter=Q(status='completed'))
        ).order_by('-total')[:100])
        totals['by_outcome'] = list(queryset.exclude(outcome_key_snapshot='').values(
            'type', 'outcome_key_snapshot', 'outcome_label_snapshot'
        ).annotate(total=Count('id')).order_by('-total')[:100])
        totals['by_type'] = list(queryset.values('type').annotate(total=Count('id'), completed=Count('id', filter=Q(status='completed'))).order_by('type'))
        return Response(totals)

    @action(detail=False, methods=['post'])
    @transaction.atomic
    def bulk(self, request):
        payload = ActivityBulkSerializer(data=request.data, context=self.get_serializer_context())
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        ids = list(dict.fromkeys(data['ids']))
        activities = list(Activity.objects.select_for_update().filter(organization=self.org, id__in=ids))
        if len(activities) != len(ids):
            raise serializers.ValidationError({'ids': 'One or more activities are unavailable.'})
        for activity in activities:
            self.check_object_permissions(request, activity)
            operation = data['action']
            if operation == 'complete':
                complete_activity(activity, request.user)
            elif operation == 'cancel':
                cancel_activity(activity, request.user, reason=data.get('reason', 'Bulk cancellation'))
            elif operation == 'assign':
                assign_activity(activity, request.user, assigned_to=data.get('assigned_to'), team=data.get('team'))
            elif operation == 'reschedule':
                target = data['due_at']
                if activity.all_day:
                    reschedule_activity(
                        activity, request.user, due_at=None,
                        due_date=target.astimezone(ZoneInfo(activity.scheduled_timezone)).date(),
                        starts_at=None, ends_at=None, all_day=True,
                    )
                elif activity.type == Activity.Type.MEETING and activity.starts_at and activity.ends_at:
                    duration = activity.ends_at - activity.starts_at
                    reschedule_activity(
                        activity, request.user, due_at=activity.due_at, due_date=None,
                        starts_at=target, ends_at=target + duration, all_day=False,
                    )
                else:
                    reschedule_activity(
                        activity, request.user, due_at=target, due_date=None,
                        starts_at=activity.starts_at, ends_at=activity.ends_at, all_day=False,
                    )
            elif operation in ('archive', 'restore'):
                activity.archived_at = timezone.now() if operation == 'archive' else None
                activity.updated_by = request.user
                activity.version = F('version') + 1
                activity.save(update_fields=['archived_at', 'updated_by', 'version', 'updated_at'])
                if operation == 'archive':
                    activity.reminders.filter(status__in=(
                        ActivityReminder.Status.SCHEDULED, ActivityReminder.Status.PROCESSING,
                        ActivityReminder.Status.FAILED,
                    )).update(
                        status=ActivityReminder.Status.CANCELLED, updated_by=request.user
                    )
                activity.refresh_from_db()
                record_activity_event(activity, request.user, f'activity.{operation}', history_event=operation)
            elif operation == 'priority':
                before = activity.priority
                activity.priority = data['priority']
                activity.updated_by = request.user
                activity.version = F('version') + 1
                activity.save(update_fields=['priority', 'updated_by', 'version', 'updated_at'])
                activity.refresh_from_db()
                record_activity_event(activity, request.user, 'activity.updated', changes={'priority': {'from': before, 'to': activity.priority}})
        record_event(
            organization=self.org, actor=request.user, event_type='activity.bulk_updated',
            instance=activities[0], metadata={'action': data['action'], 'count': len(activities)},
        )
        return Response({'updated': len(activities)})


class ActivityOutcomeDefinitionViewSet(TenantViewSet):
    queryset = ActivityOutcomeDefinition.objects.all()
    serializer_class = ActivityOutcomeDefinitionSerializer
    permission_classes = [IsAuthenticated, IsOrgMember, ActivityConfigurationPermission]
    filterset_fields = ['category', 'active']
    search_fields = ['key', 'label']
    ordering_fields = ['display_order', 'label', 'created_at']

    @transaction.atomic
    def perform_create(self, serializer):
        super().perform_create(serializer)
        record_event(
            organization=self.org, actor=self.request.user,
            event_type='activity_outcome.created', instance=serializer.instance,
        )

    @transaction.atomic
    def perform_update(self, serializer):
        before = {
            field: getattr(serializer.instance, field)
            for field in ('label', 'active', 'display_order')
        }
        super().perform_update(serializer)
        changes = {
            field: {'from': before[field], 'to': getattr(serializer.instance, field)}
            for field in before if before[field] != getattr(serializer.instance, field)
        }
        if changes:
            record_event(
                organization=self.org, actor=self.request.user,
                event_type='activity_outcome.updated', instance=serializer.instance,
                field_diff=changes,
            )

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        outcome = self.get_object()
        outcome.active = False
        outcome.archived_at = timezone.now()
        outcome.updated_by = request.user
        outcome.save(update_fields=['active', 'archived_at', 'updated_by', 'updated_at'])
        record_event(
            organization=self.org, actor=request.user,
            event_type='activity_outcome.archived', instance=outcome,
            field_diff={'active': {'from': True, 'to': False}},
        )
        return Response(status=204)


class RecurrenceSeriesViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = RecurrenceSeriesSerializer
    permission_classes = [IsAuthenticated, IsOrgMember, ActivityPermission]

    def get_queryset(self):
        membership = get_membership(self.request)
        queryset = ActivityRecurrenceSeries.objects.filter(
            organization=membership.organization
        ).select_related('template_activity')
        if membership.role not in ('owner', 'admin', 'manager'):
            queryset = queryset.filter(
                Q(template_activity__assigned_to=self.request.user) |
                Q(template_activity__assigned_to__isnull=True, template_activity__team__isnull=True) |
                Q(template_activity__team__members=self.request.user) |
                Q(template_activity__attendees__user=self.request.user)
            ).distinct()
        return queryset

    @action(detail=True, methods=['post'])
    def generate(self, request, pk=None):
        series = self.get_object()
        created = generate_series_occurrences(series, actor=request.user)
        return Response({'generated': len(created), 'activity_ids': [item.id for item in created]})

    @action(detail=True, methods=['post'], url_path='edit-future')
    def edit_future(self, request, pk=None):
        payload = serializers.Serializer(data=request.data)
        payload.fields['effective_from'] = serializers.DateTimeField()
        payload.fields['rule'] = serializers.CharField(max_length=500)
        payload.is_valid(raise_exception=True)
        result = edit_future_occurrences(self.get_object(), request.user, **payload.validated_data)
        return Response(self.get_serializer(result).data, status=201)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def cancel(self, request, pk=None):
        visible_series = self.get_object()
        series = ActivityRecurrenceSeries.objects.select_for_update().filter(
            organization=get_membership(request).organization, pk=visible_series.pk
        ).first()
        if not series:
            return Response({'detail': 'Not found.'}, status=404)
        now = timezone.now()
        series.active = False
        series.ended_at = now
        series.updated_by = request.user
        series.save(update_fields=['active', 'ended_at', 'updated_by', 'updated_at'])
        future = list(series.occurrences.filter(
            occurrence_start__gt=now, status__in=(Activity.Status.OPEN, Activity.Status.IN_PROGRESS)
        )[:501])
        if len(future) > 500:
            raise serializers.ValidationError({'series': 'More than 500 occurrences require a background cancellation job.'})
        for occurrence in future:
            cancel_activity(occurrence, request.user, reason='Recurring series cancelled')
        record_event(
            organization=series.organization, actor=request.user, event_type='activity.recurrence_cancelled',
            instance=series, metadata={'series_id': series.id, 'cancelled_occurrences': len(future)},
        )
        return Response(self.get_serializer(series).data)


class BusinessHoursPolicyViewSet(TenantViewSet):
    queryset = BusinessHoursPolicy.objects.all()
    serializer_class = BusinessHoursPolicySerializer
    permission_classes = [IsAuthenticated, IsOrgMember, ActivityConfigurationPermission]
    filterset_fields = ['active', 'is_default']


class NoteViewSet(TenantViewSet):
    queryset = Note.objects.all()
    serializer_class = NoteSerializer
    filterset_fields = ['contact', 'company', 'deal', 'lead']
    ordering_fields = ['created_at']

    def get_queryset(self):
        archived = self.request.query_params.get('archived', 'false')
        queryset = super().get_queryset().select_related('author', 'contact', 'company', 'deal', 'lead')
        if archived == 'only':
            return queryset.filter(archived_at__isnull=False)
        if archived != 'all':
            return queryset.filter(archived_at__isnull=True)
        return queryset

    @transaction.atomic
    def perform_create(self, serializer):
        note = serializer.save(organization=self.org, created_by=self.request.user, updated_by=self.request.user, author=self.request.user)
        for target in (note.lead, note.contact, note.company, note.deal):
            if target:
                record_event(organization=self.org, actor=self.request.user, event_type=f'{target._meta.model_name}.note_created', instance=target, metadata={'note_id': note.id}, audit=False)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        note = self.get_object()
        membership = get_membership(request)
        if note.author_id != request.user.id and membership.role not in ('owner', 'admin'):
            return Response({'detail': 'Only the author or an administrator may archive this note.'}, status=403)
        note.archived_at = timezone.now()
        note.updated_by = request.user
        note.save(update_fields=['archived_at', 'updated_by', 'updated_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        note = self.get_object()
        membership = get_membership(request)
        if note.author_id != request.user.id and membership.role not in ('owner', 'admin'):
            return Response({'detail': 'Only the author or an administrator may edit this note.'}, status=403)
        return super().update(request, *args, **kwargs)

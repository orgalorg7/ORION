from django.db.models import DateTimeField, OuterRef, Q, Subquery
from django.db.models.functions import Cast, Coalesce

from .models import Activity


def annotate_activity_summary(queryset, relation_field):
    """Correlated, index-backed activity summary without per-row queries or drift."""
    base = Activity.objects.filter(
        organization_id=OuterRef('organization_id'),
        archived_at__isnull=True,
        **{f'{relation_field}_id': OuterRef('pk')},
    )
    last = base.filter(status=Activity.Status.COMPLETED).order_by('-completed_at', '-id')
    upcoming = base.filter(
        status__in=(Activity.Status.OPEN, Activity.Status.IN_PROGRESS),
    ).annotate(
        _timed_at=Coalesce('snoozed_until', 'starts_at', 'due_at', output_field=DateTimeField()),
        _sort_at=Coalesce(
            'snoozed_until', 'starts_at', 'due_at', Cast('due_date', DateTimeField()),
            output_field=DateTimeField(),
        )
    ).filter(_sort_at__isnull=False).order_by('_sort_at', 'id')
    return queryset.annotate(
        last_activity_at=Subquery(last.values('completed_at')[:1]),
        next_activity_at=Subquery(upcoming.values('_timed_at')[:1]),
        next_activity_due_date=Subquery(upcoming.values('due_date')[:1]),
        next_activity_all_day=Subquery(upcoming.values('all_day')[:1]),
        next_activity_id=Subquery(upcoming.values('id')[:1]),
        next_activity_title=Subquery(upcoming.values('title')[:1]),
        next_activity_type=Subquery(upcoming.values('type')[:1]),
    )

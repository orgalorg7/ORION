import django_filters
from django.db.models import OuterRef, Q, Subquery
from django.utils import timezone
from rest_framework import serializers

from apps.activities.models import Activity

from .analytics import effective_probability_expression
from .models import Deal


class NumberInFilter(django_filters.BaseInFilter, django_filters.NumberFilter):
    def filter(self, qs, value):
        if value and len(value) > 50:
            raise serializers.ValidationError({self.field_name: 'Use at most 50 ids.'})
        return super().filter(qs, value)


class DealFilter(django_filters.FilterSet):
    pipeline = NumberInFilter(field_name='pipeline_id', lookup_expr='in')
    stage = NumberInFilter(field_name='stage_id', lookup_expr='in')
    owner = NumberInFilter(field_name='owner_id', lookup_expr='in')
    team = NumberInFilter(field_name='team_id', lookup_expr='in')
    tags = NumberInFilter(method='filter_tags')
    status = django_filters.MultipleChoiceFilter(choices=Deal.Status.choices)
    priority = django_filters.MultipleChoiceFilter(choices=Deal.Priority.choices)
    amount_min = django_filters.NumberFilter(field_name='value', lookup_expr='gte')
    amount_max = django_filters.NumberFilter(field_name='value', lookup_expr='lte')
    probability_min = django_filters.NumberFilter(method='filter_probability_min')
    probability_max = django_filters.NumberFilter(method='filter_probability_max')
    expected_close_from = django_filters.DateFilter(field_name='expected_close_date', lookup_expr='gte')
    expected_close_to = django_filters.DateFilter(field_name='expected_close_date', lookup_expr='lte')
    created_from = django_filters.IsoDateTimeFilter(field_name='created_at', lookup_expr='gte')
    created_to = django_filters.IsoDateTimeFilter(field_name='created_at', lookup_expr='lte')
    won_from = django_filters.IsoDateTimeFilter(field_name='won_at', lookup_expr='gte')
    won_to = django_filters.IsoDateTimeFilter(field_name='won_at', lookup_expr='lte')
    lost_from = django_filters.IsoDateTimeFilter(field_name='lost_at', lookup_expr='gte')
    lost_to = django_filters.IsoDateTimeFilter(field_name='lost_at', lookup_expr='lte')
    unassigned = django_filters.BooleanFilter(method='filter_unassigned')
    stale = django_filters.BooleanFilter(method='filter_stale')

    class Meta:
        model = Deal
        fields = ['company', 'contact', 'source', 'forecast_category', 'value_mode']

    def filter_queryset(self, queryset):
        return super().filter_queryset(queryset).distinct()

    def filter_probability_min(self, queryset, name, value):
        return queryset.annotate(_effective_probability=effective_probability_expression()).filter(
            _effective_probability__gte=value
        )

    def filter_probability_max(self, queryset, name, value):
        return queryset.annotate(_effective_probability=effective_probability_expression()).filter(
            _effective_probability__lte=value
        )

    def filter_unassigned(self, queryset, name, value):
        return queryset.filter(owner__isnull=True, team__isnull=True) if value else queryset

    def filter_tags(self, queryset, name, value):
        through = Deal.tags.through.objects.filter(tag_id__in=value).values('deal_id')
        return queryset.filter(pk__in=through)

    def filter_stale(self, queryset, name, value):
        if not value:
            return queryset
        today = timezone.localdate()
        last_activity = Activity.objects.filter(
            organization_id=OuterRef('organization_id'), deal_id=OuterRef('pk'),
            status=Activity.Status.COMPLETED, archived_at__isnull=True,
        ).order_by('-completed_at').values('completed_at')[:1]
        now = timezone.now()
        stale_by_pipeline = Q()
        thresholds = queryset.order_by().values_list(
            'pipeline_id', 'pipeline__stale_activity_days', 'pipeline__stale_stage_days'
        ).distinct()[:100]
        for pipeline_id, activity_days, stage_days in thresholds:
            activity_cutoff = now - timezone.timedelta(days=activity_days)
            stage_cutoff = now - timezone.timedelta(days=stage_days)
            stale_by_pipeline |= Q(pipeline_id=pipeline_id) & (
                Q(stage_entered_at__lt=stage_cutoff) |
                Q(_last_activity__lt=activity_cutoff) |
                Q(_last_activity__isnull=True, created_at__lt=activity_cutoff)
            )
        return queryset.annotate(_last_activity=Subquery(last_activity)).filter(
            status=Deal.Status.OPEN
        ).filter(Q(expected_close_date__lt=today) | stale_by_pipeline)

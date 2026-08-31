from datetime import timedelta
from decimal import Decimal

from django.db.models import (
    Avg, Case, Count, DateField, DecimalField, DurationField, ExpressionWrapper, F, IntegerField, Q, Sum,
    Value, When,
)
from django.db.models.functions import Coalesce, TruncMonth, TruncQuarter
from django.utils import timezone

from .models import Deal, DealStageHistory, Stage


MONEY_OUTPUT = DecimalField(max_digits=24, decimal_places=2)


def effective_probability_expression():
    return Case(
        When(Q(status=Deal.Status.WON) | Q(stage__stage_type=Stage.Type.WON), then=Value(100)),
        When(
            Q(status__in=(Deal.Status.LOST, Deal.Status.ABANDONED)) | Q(stage__stage_type=Stage.Type.LOST),
            then=Value(0),
        ),
        When(probability_override__isnull=False, then=F('probability_override')),
        default=F('stage__probability'),
        output_field=IntegerField(),
    )


def weighted_expression():
    return ExpressionWrapper(
        F('value') * effective_probability_expression() / Value(Decimal('100')),
        output_field=MONEY_OUTPUT,
    )


def scoped_deals(organization, filters=None):
    filters = filters or {}
    queryset = Deal.objects.filter(organization=organization, archived_at__isnull=True)
    exact = {
        'pipeline': 'pipeline_id', 'stage': 'stage_id', 'owner': 'owner_id', 'team': 'team_id',
        'company': 'company_id', 'contact': 'contact_id', 'source': 'source',
    }
    for key, field in exact.items():
        if filters.get(key) not in (None, ''):
            queryset = queryset.filter(**{field: filters[key]})
    if filters.get('date_from'):
        queryset = queryset.filter(created_at__date__gte=filters['date_from'])
    if filters.get('date_to'):
        queryset = queryset.filter(created_at__date__lte=filters['date_to'])
    if filters.get('tags'):
        tagged_deals = Deal.tags.through.objects.filter(tag_id__in=filters['tags']).values('deal_id')
        queryset = queryset.filter(pk__in=tagged_deals)
    return queryset


def _money_rows(queryset, group_fields=()):
    rows = list(
        queryset.values(*group_fields, 'currency')
        .annotate(
            count=Count('id', distinct=True),
            total_value=Coalesce(Sum('value'), Value(Decimal('0')), output_field=MONEY_OUTPUT),
            weighted_value=Coalesce(Sum(weighted_expression()), Value(Decimal('0')), output_field=MONEY_OUTPUT),
        )
        .order_by(*group_fields, 'currency')
    )
    for row in rows:
        row['value'] = row.pop('total_value')
    return rows


def pipeline_analytics(organization, filters=None):
    queryset = scoped_deals(organization, filters).select_related('stage')
    open_deals = queryset.filter(status=Deal.Status.OPEN)
    terminal = queryset.filter(status__in=(Deal.Status.WON, Deal.Status.LOST, Deal.Status.ABANDONED))
    won = queryset.filter(status=Deal.Status.WON)
    lost = queryset.filter(status=Deal.Status.LOST)
    abandoned = queryset.filter(status=Deal.Status.ABANDONED)
    now = timezone.localdate()
    soon = now + timedelta(days=30)

    stages = _money_rows(open_deals, ('stage_id', 'stage__name', 'stage__order', 'stage__color'))
    outcomes = terminal.aggregate(total=Count('id'), won=Count('id', filter=Q(status=Deal.Status.WON)))
    outcome_total = outcomes['total'] or 0
    win_rate = (Decimal(outcomes['won'] or 0) * 100 / Decimal(outcome_total)).quantize(Decimal('0.01')) \
        if outcome_total else None

    won_cycles = won.filter(actual_close_date__isnull=False).annotate(
        cycle=ExpressionWrapper(F('actual_close_date') - F('created_at__date'), output_field=DurationField())
    )
    average_cycle = won_cycles.aggregate(value=Avg('cycle'))['value']

    history = DealStageHistory.objects.filter(
        organization=organization,
        deal_id__in=queryset.values('id'),
        exited_at__isnull=False,
    ).annotate(duration=ExpressionWrapper(F('exited_at') - F('entered_at'), output_field=DurationField()))
    stage_durations = list(
        history.values('to_stage_id', 'to_stage__name')
        .annotate(transitions=Count('id'), average_duration=Avg('duration'))
        .order_by('to_stage__order', 'to_stage_id')
    )
    conversions = list(
        DealStageHistory.objects.filter(
            organization=organization,
            deal_id__in=queryset.values('id'),
            from_stage__isnull=False,
        ).values('from_stage_id', 'from_stage__name', 'to_stage_id', 'to_stage__name')
        .annotate(count=Count('id')).order_by('from_stage_id', 'to_stage_id')
    )
    exits_by_stage = {}
    for row in conversions:
        exits_by_stage[row['from_stage_id']] = exits_by_stage.get(row['from_stage_id'], 0) + row['count']
    for row in conversions:
        exits = exits_by_stage[row['from_stage_id']]
        row['conversion_rate'] = (Decimal(row['count']) * 100 / Decimal(exits)).quantize(Decimal('0.01'))
    velocity = None
    if outcome_total >= 5 and average_cycle and average_cycle.days > 0:
        average_value = won.aggregate(value=Avg('value'))['value'] or Decimal('0')
        velocity = (
            Decimal(open_deals.count()) * average_value * (win_rate or Decimal('0')) /
            Decimal('100') / Decimal(average_cycle.days)
        ).quantize(Decimal('0.01'))

    return {
        'open_pipeline': _money_rows(open_deals),
        'won': _money_rows(won),
        'lost': _money_rows(lost),
        'abandoned': _money_rows(abandoned),
        'by_stage': stages,
        'win_rate': win_rate,
        'average_deal_size': list(won.values('currency').annotate(value=Avg('value')).order_by('currency')),
        'average_sales_cycle_days': average_cycle.days if average_cycle else None,
        'pipeline_velocity_per_day': velocity,
        'closing_soon': open_deals.filter(expected_close_date__range=(now, soon)).count(),
        'overdue': open_deals.filter(expected_close_date__lt=now).count(),
        'stage_durations': stage_durations,
        'stage_conversions': conversions,
        'lost_reasons': list(
            lost.values('lost_reason_record_id', 'lost_reason_record__label')
            .annotate(count=Count('id')).order_by('-count', 'lost_reason_record_id')
        ),
    }


def forecast(organization, filters=None, period='month'):
    filters = filters or {}
    queryset = scoped_deals(organization, filters).exclude(status__in=(Deal.Status.LOST, Deal.Status.ABANDONED))
    date_expression = Case(
        When(status=Deal.Status.WON, then=F('actual_close_date')),
        default=F('expected_close_date'),
    )
    queryset = queryset.annotate(forecast_date=date_expression).exclude(forecast_date__isnull=True)
    if filters.get('forecast_from'):
        queryset = queryset.filter(forecast_date__gte=filters['forecast_from'])
    if filters.get('forecast_to'):
        queryset = queryset.filter(forecast_date__lte=filters['forecast_to'])
    if period == 'custom':
        truncator = Value(filters['forecast_from'], output_field=DateField())
    else:
        truncator = TruncQuarter('forecast_date') if period == 'quarter' else TruncMonth('forecast_date')
    rows = list(
        queryset.annotate(period=truncator).values('period', 'currency', 'forecast_category')
        .annotate(
            count=Count('id'),
            total_value=Coalesce(Sum('value'), Value(Decimal('0')), output_field=MONEY_OUTPUT),
            weighted_value=Coalesce(Sum(weighted_expression()), Value(Decimal('0')), output_field=MONEY_OUTPUT),
        ).order_by('period', 'currency', 'forecast_category')
    )
    for row in rows:
        row['value'] = row.pop('total_value')
    return rows

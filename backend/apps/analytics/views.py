from django.db.models import Count, Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.activities.models import Activity
from apps.contacts.models import Company, Contact
from apps.core.permissions import IsOrgMember
from apps.core.utils import get_membership
from apps.deals.models import Deal, Pipeline
from apps.hr.models import Employee
from apps.leads.models import Lead
from apps.support.models import Ticket


def _shift_month(month_start, months):
    """Shift a month-start datetime by ``months`` whole calendar months."""
    total = month_start.year * 12 + (month_start.month - 1) + months
    return month_start.replace(year=total // 12, month=total % 12 + 1)


def _activity_item(activity):
    return {
        'id': activity.id,
        'type': activity.type,
        'title': activity.title,
        'due_at': activity.due_at.isoformat() if activity.due_at else None,
        'completed': activity.completed,
        'created_at': activity.created_at.isoformat(),
    }


class DashboardView(APIView):
    """Aggregated dashboard numbers for the active organization."""

    permission_classes = [IsAuthenticated, IsOrgMember]

    def get(self, request):
        org = get_membership(request).organization
        now = timezone.now()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        next_month_start = _shift_month(month_start, 1)

        deals = Deal.objects.filter(organization=org)
        open_deals = deals.filter(status=Deal.Status.OPEN)
        won_this_month = deals.filter(
            status=Deal.Status.WON, closed_at__gte=month_start, closed_at__lt=next_month_start
        )
        leads = Lead.objects.filter(organization=org)
        activities = Activity.objects.filter(organization=org)

        totals = {
            'contacts': Contact.objects.filter(organization=org).count(),
            'companies': Company.objects.filter(organization=org).count(),
            'open_deals': open_deals.count(),
            'open_deals_value': float(open_deals.aggregate(total=Sum('value'))['total'] or 0),
            'won_deals_this_month': won_this_month.count(),
            'won_value_this_month': float(won_this_month.aggregate(total=Sum('value'))['total'] or 0),
            'new_leads_this_month': leads.filter(
                created_at__gte=month_start, created_at__lt=next_month_start
            ).count(),
            'open_tickets': Ticket.objects.filter(
                organization=org, status__in=[Ticket.Status.OPEN, Ticket.Status.IN_PROGRESS]
            ).count(),
            'active_employees': Employee.objects.filter(
                organization=org, status=Employee.Status.ACTIVE
            ).count(),
        }

        return Response({
            'totals': totals,
            'deals_by_stage': self._deals_by_stage(request, org, open_deals),
            'revenue_by_month': self._revenue_by_month(deals, month_start),
            'leads_by_source': self._leads_by_source(leads),
            'leads_by_status': self._leads_by_status(leads),
            'recent_activities': [
                _activity_item(activity) for activity in activities.order_by('-created_at')[:5]
            ],
            'upcoming_activities': [
                _activity_item(activity)
                for activity in activities.filter(completed=False, due_at__gte=now).order_by('due_at')[:5]
            ],
            'top_deals': self._top_deals(open_deals),
        })

    def _deals_by_stage(self, request, org, open_deals):
        pipelines = Pipeline.objects.filter(organization=org)
        pipeline = None
        pipeline_id = request.query_params.get('pipeline')
        if pipeline_id:
            try:
                pipeline = pipelines.filter(pk=int(pipeline_id)).first()
            except (TypeError, ValueError):
                pipeline = None
        if pipeline is None:
            pipeline = pipelines.filter(is_default=True).first() or pipelines.first()
        if pipeline is None:
            return []

        by_stage = {
            row['stage_id']: row
            for row in open_deals.filter(stage__pipeline=pipeline)
            .values('stage_id')
            .annotate(count=Count('id'), total=Sum('value'))
        }
        return [
            {
                'stage_id': stage.id,
                'stage_name': stage.name,
                'color': stage.color,
                'count': by_stage.get(stage.id, {}).get('count', 0),
                'value': float(by_stage.get(stage.id, {}).get('total') or 0),
            }
            for stage in pipeline.stages.all()
        ]

    def _revenue_by_month(self, deals, month_start):
        first_month = _shift_month(month_start, -5)
        next_month_start = _shift_month(month_start, 1)
        rows = (
            deals.filter(
                status=Deal.Status.WON, closed_at__gte=first_month, closed_at__lt=next_month_start
            )
            .annotate(month=TruncMonth('closed_at'))
            .values('month')
            .annotate(total=Sum('value'), count=Count('id'))
        )
        by_month = {row['month'].strftime('%Y-%m'): row for row in rows}

        result = []
        for offset in range(-5, 1):
            key = _shift_month(month_start, offset).strftime('%Y-%m')
            row = by_month.get(key)
            result.append({
                'month': key,
                'value': float(row['total'] or 0) if row else 0.0,
                'count': row['count'] if row else 0,
            })
        return result

    def _leads_by_source(self, leads):
        counts = {}
        for row in leads.values('source').annotate(count=Count('id')):
            source = row['source'] or 'other'
            counts[source] = counts.get(source, 0) + row['count']
        return [
            {'source': source, 'count': count}
            for source, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
        ]

    def _leads_by_status(self, leads):
        counts = dict(leads.values_list('status').annotate(count=Count('id')))
        return [{'status': value, 'count': counts.get(value, 0)} for value in Lead.Status.values]

    def _top_deals(self, open_deals):
        return [
            {
                'id': deal.id,
                'title': deal.title,
                'value': float(deal.value),
                'currency': deal.currency,
                'stage_name': deal.stage.name if deal.stage else '',
                'company_name': deal.company.name if deal.company else '',
            }
            for deal in open_deals.select_related('stage', 'company').order_by('-value')[:5]
        ]

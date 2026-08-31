import django_filters
from django.db import transaction
from django.db.models import Q
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.viewsets import TenantViewSet
from apps.activities.projections import annotate_activity_summary
from apps.customer_core.conversion import convert_lead
from apps.customer_core.mixins import CustomerRecordViewSetMixin
from apps.customer_core.scoring import LeadScoringService

from .models import Lead
from .serializers import LeadConvertSerializer, LeadSerializer


class LeadFilterSet(django_filters.FilterSet):
    score_min = django_filters.NumberFilter(field_name='score', lookup_expr='gte')
    score_max = django_filters.NumberFilter(field_name='score', lookup_expr='lte')
    estimated_value_min = django_filters.NumberFilter(field_name='estimated_value', lookup_expr='gte')
    estimated_value_max = django_filters.NumberFilter(field_name='estimated_value', lookup_expr='lte')
    created_from = django_filters.IsoDateTimeFilter(field_name='created_at', lookup_expr='gte')
    created_to = django_filters.IsoDateTimeFilter(field_name='created_at', lookup_expr='lte')
    tags = django_filters.BaseInFilter(field_name='tags__id', lookup_expr='in')
    tags_all = django_filters.CharFilter(method='filter_tags_all')
    unassigned = django_filters.BooleanFilter(method='filter_unassigned')

    class Meta:
        model = Lead
        fields = [
            'owner', 'team', 'source', 'source_record', 'status', 'lifecycle_stage', 'company',
            'country', 'city', 'temperature',
        ]

    def filter_unassigned(self, queryset, name, value):
        return queryset.filter(owner__isnull=True) if value else queryset

    def filter_tags_all(self, queryset, name, value):
        for tag_id in filter(None, value.split(',')):
            queryset = queryset.filter(tags__id=tag_id)
        return queryset


class LeadViewSet(CustomerRecordViewSetMixin, TenantViewSet):
    queryset = Lead.objects.all()
    serializer_class = LeadSerializer
    custom_target = 'lead'
    event_prefix = 'lead'
    filterset_class = LeadFilterSet
    search_fields = [
        'first_name', 'last_name', 'display_name', 'normalized_name', 'email', 'normalized_email',
        'phone', 'normalized_phone', 'company_name', 'company__name', 'company__normalized_name',
    ]
    ordering_fields = [
        'display_name', 'created_at', 'updated_at', 'score', 'estimated_value', 'company_name', 'owner',
    ]
    ordering = ['-created_at', '-id']

    def get_queryset(self):
        queryset = (
            super()
            .get_queryset()
            .select_related('owner', 'team', 'company', 'source_record')
            .prefetch_related('tags')
            .distinct()
        )
        return annotate_activity_summary(queryset, 'lead')

    def _apply_score(self, lead):
        result = LeadScoringService.calculate(lead)
        if lead.score != result['score'] or lead.score_breakdown != result['reasons']:
            lead.score = result['score']
            lead.score_breakdown = result['reasons']
            lead.save(update_fields=['score', 'score_breakdown', 'updated_at'])

    @transaction.atomic
    def perform_create(self, serializer):
        super().perform_create(serializer)
        self._apply_score(serializer.instance)

    @transaction.atomic
    def perform_update(self, serializer):
        super().perform_update(serializer)
        self._apply_score(serializer.instance)

    @action(detail=True, methods=['post'], url_path='convert')
    def convert(self, request, pk=None):
        # Resolve via the scoped queryset first so foreign-tenant ids remain indistinguishable from missing ids.
        lead = self.get_object()
        payload = LeadConvertSerializer(data=request.data, context=self.get_serializer_context())
        payload.is_valid(raise_exception=True)
        result = convert_lead(
            lead_id=lead.pk,
            organization=self.org,
            actor=request.user,
            data=payload.validated_data,
        )
        result['lead'] = self.get_serializer(result['lead']).data
        return Response(result)

import django_filters
from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.viewsets import TenantViewSet
from apps.activities.projections import annotate_activity_summary
from apps.customer_core.events import record_event
from apps.customer_core.mixins import CustomerRecordViewSetMixin

from .models import Company, Contact, Tag
from .serializers import CompanySerializer, ContactSerializer, TagSerializer


class CompanyFilterSet(django_filters.FilterSet):
    revenue_min = django_filters.NumberFilter(field_name='annual_revenue', lookup_expr='gte')
    revenue_max = django_filters.NumberFilter(field_name='annual_revenue', lookup_expr='lte')
    created_from = django_filters.IsoDateTimeFilter(field_name='created_at', lookup_expr='gte')
    created_to = django_filters.IsoDateTimeFilter(field_name='created_at', lookup_expr='lte')
    tags = django_filters.BaseInFilter(field_name='tags__id', lookup_expr='in')
    tags_all = django_filters.CharFilter(method='filter_tags_all')
    unassigned = django_filters.BooleanFilter(method='filter_unassigned')

    class Meta:
        model = Company
        fields = ['industry', 'size', 'owner', 'team', 'country', 'city', 'lifecycle_stage', 'source']

    def filter_unassigned(self, queryset, name, value):
        return queryset.filter(owner__isnull=True) if value else queryset

    def filter_tags_all(self, queryset, name, value):
        for tag_id in filter(None, value.split(',')):
            queryset = queryset.filter(tags__id=tag_id)
        return queryset


class ContactFilterSet(django_filters.FilterSet):
    created_from = django_filters.IsoDateTimeFilter(field_name='created_at', lookup_expr='gte')
    created_to = django_filters.IsoDateTimeFilter(field_name='created_at', lookup_expr='lte')
    tags = django_filters.BaseInFilter(field_name='tags__id', lookup_expr='in')
    tags_all = django_filters.CharFilter(method='filter_tags_all')
    unassigned = django_filters.BooleanFilter(method='filter_unassigned')

    class Meta:
        model = Contact
        fields = [
            'company', 'owner', 'team', 'source', 'lifecycle_stage', 'is_active', 'country', 'city',
        ]

    def filter_unassigned(self, queryset, name, value):
        return queryset.filter(owner__isnull=True) if value else queryset

    def filter_tags_all(self, queryset, name, value):
        for tag_id in filter(None, value.split(',')):
            queryset = queryset.filter(tags__id=tag_id)
        return queryset


class TagViewSet(TenantViewSet):
    queryset = Tag.objects.all()
    serializer_class = TagSerializer
    search_fields = ['name', 'normalized_name']
    ordering_fields = ['name', 'created_at']
    ordering = ['name', 'id']

    def get_queryset(self):
        queryset = super().get_queryset()
        archived = self.request.query_params.get('archived', 'false')
        return queryset if archived == 'all' else queryset.filter(archived_at__isnull=archived not in ('only', 'true'))

    def perform_create(self, serializer):
        try:
            with transaction.atomic():
                super().perform_create(serializer)
        except IntegrityError as exc:
            raise serializers.ValidationError({'name': 'A tag with this normalized name already exists.'}) from exc

    def destroy(self, request, *args, **kwargs):
        tag = self.get_object()
        tag.archived_at = timezone.now()
        tag.updated_by = request.user
        tag.save(update_fields=['archived_at', 'updated_by', 'updated_at'])
        return Response(status=204)

    @action(detail=True, methods=['post'])
    def restore(self, request, pk=None):
        tag = Tag.objects.filter(organization=self.org, pk=pk).first()
        if tag is None:
            return Response({'detail': 'Not found.'}, status=404)
        tag.archived_at = None
        tag.updated_by = request.user
        tag.save(update_fields=['archived_at', 'updated_by', 'updated_at'])
        return Response(self.get_serializer(tag).data)


class CompanyViewSet(CustomerRecordViewSetMixin, TenantViewSet):
    queryset = Company.objects.all()
    serializer_class = CompanySerializer
    custom_target = 'company'
    event_prefix = 'company'
    filterset_class = CompanyFilterSet
    search_fields = [
        'name', 'normalized_name', 'legal_name', 'domain', 'normalized_domain', 'phone',
        'normalized_phone', 'email', 'city',
    ]
    ordering_fields = ['name', 'created_at', 'updated_at', 'annual_revenue', 'owner']
    ordering = ['-created_at', '-id']

    def get_queryset(self):
        queryset = (
            super()
            .get_queryset()
            .select_related('owner', 'team', 'source_record')
            .prefetch_related('tags')
            .annotate(contacts_count=Count('contacts', filter=Q(contacts__archived_at__isnull=True), distinct=True))
            .distinct()
        )
        return annotate_activity_summary(queryset, 'company')


class ContactViewSet(CustomerRecordViewSetMixin, TenantViewSet):
    queryset = Contact.objects.all()
    serializer_class = ContactSerializer
    custom_target = 'contact'
    event_prefix = 'contact'
    filterset_class = ContactFilterSet
    search_fields = [
        'first_name', 'last_name', 'display_name', 'normalized_name', 'email', 'normalized_email',
        'phone', 'normalized_phone', 'company__name', 'company__normalized_name', 'job_title',
    ]
    ordering_fields = ['first_name', 'last_name', 'display_name', 'created_at', 'updated_at', 'company', 'owner']
    ordering = ['-created_at', '-id']

    def get_queryset(self):
        queryset = (
            super()
            .get_queryset()
            .select_related('company', 'owner', 'team', 'source_record')
            .prefetch_related('tags')
            .distinct()
        )
        return annotate_activity_summary(queryset, 'contact')

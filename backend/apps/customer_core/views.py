from django.http import StreamingHttpResponse
from django.db import IntegrityError, transaction
from django.db.models import F, Q
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import IsOrgMember
from apps.core.utils import get_membership
from apps.core.viewsets import TenantViewSet

from .import_export import csv_stream, export_queryset, preview_import, process_import
from .events import record_event
from .models import AuditLog, CustomFieldDefinition, ImportJob, LeadSource, Team
from .serializers import (
    AuditLogSerializer,
    CustomFieldDefinitionSerializer,
    ImportJobSerializer,
    LeadSourceSerializer,
    TeamSerializer,
)


class LeadSourceViewSet(TenantViewSet):
    queryset = LeadSource.objects.all()
    serializer_class = LeadSourceSerializer
    filterset_fields = ['active']
    search_fields = ['key', 'label']
    ordering_fields = ['display_order', 'label', 'created_at']
    ordering = ['display_order', 'id']

    def destroy(self, request, *args, **kwargs):
        source = self.get_object()
        source.active = False
        source.updated_by = request.user
        source.save(update_fields=['active', 'updated_by', 'updated_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)


class TeamViewSet(TenantViewSet):
    queryset = Team.objects.all()
    serializer_class = TeamSerializer
    filterset_fields = ['active']
    search_fields = ['name']
    ordering_fields = ['name', 'created_at']
    ordering = ['name', 'id']

    def destroy(self, request, *args, **kwargs):
        team = self.get_object()
        team.active = False
        team.updated_by = request.user
        team.save(update_fields=['active', 'updated_by', 'updated_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)


class CustomFieldDefinitionViewSet(TenantViewSet):
    queryset = CustomFieldDefinition.objects.all()
    serializer_class = CustomFieldDefinitionSerializer
    filterset_fields = ['target_object', 'data_type', 'active']
    search_fields = ['key', 'label', 'description']
    ordering_fields = ['display_order', 'label', 'created_at']
    ordering = ['display_order', 'id']

    @transaction.atomic
    def perform_create(self, serializer):
        super().perform_create(serializer)
        record_event(
            organization=self.org,
            actor=self.request.user,
            event_type='custom_field.created',
            instance=serializer.instance,
        )

    @transaction.atomic
    def perform_update(self, serializer):
        before = {
            'label': serializer.instance.label,
            'required': serializer.instance.required,
            'unique': serializer.instance.unique,
            'active': serializer.instance.active,
        }
        try:
            with transaction.atomic():
                super().perform_update(serializer)
                if serializer.instance.unique:
                    serializer.instance.values.exclude(normalized_value='').update(unique_value=F('normalized_value'))
                else:
                    serializer.instance.values.update(unique_value=None)
        except IntegrityError as exc:
            raise serializers.ValidationError({'unique': 'Existing values are not unique.'}) from exc
        after = {key: getattr(serializer.instance, key) for key in before}
        diff = {key: {'from': before[key], 'to': after[key]} for key in before if before[key] != after[key]}
        record_event(
            organization=self.org,
            actor=self.request.user,
            event_type='custom_field.updated',
            instance=serializer.instance,
            field_diff=diff,
        )

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        definition = self.get_object()
        if definition.active:
            definition.active = False
            definition.updated_by = request.user
            definition.save(update_fields=['active', 'updated_by', 'updated_at'])
            record_event(
                organization=self.org,
                actor=request.user,
                event_type='custom_field.archived',
                instance=definition,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AuditLogSerializer
    permission_classes = [IsOrgMember]
    filterset_fields = ['entity_type', 'entity_id', 'action', 'actor']
    ordering = ['-created_at', '-id']

    def get_queryset(self):
        return AuditLog.objects.filter(organization=get_membership(self.request).organization).select_related('actor')


class ImportJobViewSet(TenantViewSet):
    queryset = ImportJob.objects.all()
    serializer_class = ImportJobSerializer
    filterset_fields = ['target_object', 'status']
    ordering = ['-created_at', '-id']
    http_method_names = ['get', 'post', 'head', 'options']

    def perform_create(self, serializer):
        uploaded = serializer.validated_data['source_file']
        job = serializer.save(
            organization=self.org,
            created_by=self.request.user,
            updated_by=self.request.user,
            original_filename=uploaded.name[:255],
        )
        preview_import(job)

    @action(detail=True, methods=['post'])
    def process(self, request, pk=None):
        job = self.get_object()
        mapping = request.data.get('mapping')
        if not isinstance(mapping, dict):
            raise serializers.ValidationError({'mapping': 'Mapping must be an object keyed by CSV column.'})
        process_import(
            job=job,
            mapping=mapping,
            request=request,
            duplicate_policy=request.data.get('duplicate_policy', 'skip'),
        )
        return Response(self.get_serializer(job).data)


class ExportViewSet(viewsets.ViewSet):
    permission_classes = [IsOrgMember]

    def create(self, request):
        target_object = request.data.get('target_object')
        if target_object not in ('lead', 'contact', 'company', 'deal', 'activity'):
            raise serializers.ValidationError({'target_object': 'Use lead, contact, company, deal, or activity.'})
        filters = request.data.get('filters') or {}
        fields = request.data.get('fields')
        if not isinstance(filters, dict):
            raise serializers.ValidationError({'filters': 'Filters must be an object.'})
        membership = get_membership(request)
        organization = membership.organization
        queryset, selected = export_queryset(
            organization=organization,
            target_object=target_object,
            filters=filters,
            fields=fields,
            sort=request.data.get('sort'),
        )
        if target_object == 'activity' and membership.role not in ('owner', 'admin', 'manager'):
            queryset = queryset.filter(
                Q(assigned_to=request.user)
                | Q(assigned_to__isnull=True, team__isnull=True)
                | Q(team__members=request.user)
                | Q(attendees__user=request.user)
            ).distinct()
        response = StreamingHttpResponse(
            csv_stream(queryset, selected, organization, target_object), content_type='text/csv; charset=utf-8'
        )
        response['Content-Disposition'] = f'attachment; filename="orion-{target_object}s.csv"'
        response['X-Content-Type-Options'] = 'nosniff'
        return response

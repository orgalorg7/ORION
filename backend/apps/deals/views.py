from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.viewsets import TenantViewSet

from .models import Deal, Pipeline, Stage
from .serializers import DealSerializer, PipelineSerializer, StageSerializer


class PipelineViewSet(TenantViewSet):
    queryset = Pipeline.objects.all()
    serializer_class = PipelineSerializer
    search_fields = ['name']
    pagination_class = None

    def get_queryset(self):
        return super().get_queryset().prefetch_related('stages')

    def perform_create(self, serializer):
        super().perform_create(serializer)
        self._ensure_single_default(serializer.instance)

    def perform_update(self, serializer):
        serializer.save()
        self._ensure_single_default(serializer.instance)

    def _ensure_single_default(self, pipeline):
        if pipeline.is_default:
            Pipeline.objects.filter(organization=pipeline.organization).exclude(pk=pipeline.pk).update(
                is_default=False
            )

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if not Pipeline.objects.filter(organization=self.org).exclude(pk=instance.pk).exists():
            return Response(
                {'detail': "Cannot delete the organization's only pipeline."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)


class StageViewSet(TenantViewSet):
    queryset = Stage.objects.all()
    serializer_class = StageSerializer
    filterset_fields = ['pipeline']
    search_fields = ['name']
    pagination_class = None

    def get_queryset(self):
        return super().get_queryset().select_related('pipeline')


class DealViewSet(TenantViewSet):
    queryset = Deal.objects.all()
    serializer_class = DealSerializer
    filterset_fields = ['pipeline', 'stage', 'status', 'owner', 'contact', 'company', 'tags']
    search_fields = ['title', 'contact__first_name', 'contact__last_name', 'company__name']
    ordering_fields = ['value', 'created_at', 'expected_close_date']

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .select_related('stage', 'contact', 'company', 'owner')
            .prefetch_related('tags')
        )

    @action(detail=True, methods=['post'], url_path='move')
    def move(self, request, pk=None):
        deal = self.get_object()
        stage = Stage.objects.filter(
            organization=self.org, pipeline=deal.pipeline, pk=request.data.get('stage')
        ).first()
        if stage is None:
            return Response(
                {'stage': ['Stage does not belong to this deal\'s pipeline.']},
                status=status.HTTP_400_BAD_REQUEST,
            )
        deal.stage = stage
        deal.save()
        return Response(self.get_serializer(deal).data)

    @action(detail=True, methods=['post'], url_path='mark-won')
    def mark_won(self, request, pk=None):
        deal = self.get_object()
        deal.status = Deal.Status.WON
        deal.closed_at = timezone.now()
        deal.save()
        return Response(self.get_serializer(deal).data)

    @action(detail=True, methods=['post'], url_path='mark-lost')
    def mark_lost(self, request, pk=None):
        deal = self.get_object()
        deal.status = Deal.Status.LOST
        deal.closed_at = timezone.now()
        deal.lost_reason = str(request.data.get('lost_reason') or '')
        deal.save()
        return Response(self.get_serializer(deal).data)

    @action(detail=True, methods=['post'], url_path='reopen')
    def reopen(self, request, pk=None):
        deal = self.get_object()
        deal.status = Deal.Status.OPEN
        deal.closed_at = None
        deal.lost_reason = ''
        deal.save()
        return Response(self.get_serializer(deal).data)

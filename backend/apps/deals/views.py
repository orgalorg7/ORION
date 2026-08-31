from collections import defaultdict

from django.db import transaction
from django.db.models import Count, F, Max, OuterRef, Prefetch, Q, Subquery, Sum, Window
from django.db.models.functions import RowNumber
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

from apps.activities.models import Activity
from apps.activities.projections import annotate_activity_summary
from apps.core.filters import NormalizedSearchFilter, StableOrderingFilter
from apps.core.permissions import IsOrgMember
from apps.core.viewsets import TenantViewSet
from apps.core.utils import get_membership
from apps.customer_core.events import record_event
from apps.customer_core.custom_fields import prime_custom_fields
from apps.customer_core.mixins import CustomerRecordViewSetMixin
from apps.customer_core.models import Team
from apps.organizations.models import Membership

from .analytics import effective_probability_expression, forecast, pipeline_analytics, weighted_expression
from .filters import DealFilter
from .models import Deal, DealContact, DealLineItem, LostReason, Pipeline, Product, Stage
from .permissions import ConfigurationPermission, DealPermission
from .serializers import (
    DealContactSerializer, DealLineItemSerializer, DealSerializer, DealStageHistorySerializer,
    LineItemInputSerializer, LostReasonSerializer, MoveDealSerializer, ParticipantInputSerializer,
    PipelineSerializer, ProductSerializer, ReopenDealSerializer, ReorderStagesSerializer, StageSerializer,
)
from .services import add_participant, delete_line_item, move_deal, reorder_stages


DEFAULT_STAGES = (
    ('New Lead', 10, Stage.Type.OPEN, '#64748b'), ('Qualified', 30, Stage.Type.OPEN, '#3b82f6'),
    ('Proposal', 60, Stage.Type.OPEN, '#8b5cf6'), ('Negotiation', 80, Stage.Type.OPEN, '#f59e0b'),
    ('Won', 100, Stage.Type.WON, '#10b981'), ('Lost', 0, Stage.Type.LOST, '#ef4444'),
)


class PipelineViewSet(TenantViewSet):
    queryset = Pipeline.objects.all()
    serializer_class = PipelineSerializer
    permission_classes = [IsAuthenticated, IsOrgMember, ConfigurationPermission]
    search_fields = ['name', 'key']
    ordering_fields = ['display_order', 'name', 'created_at']
    ordering = ['display_order', 'id']
    pagination_class = None

    def get_queryset(self):
        stages = Stage.objects.filter(active=True, archived_at__isnull=True).annotate(
            deals_count=Count('deals', filter=Q(deals__archived_at__isnull=True))
        ).order_by('order', 'id')
        queryset = super().get_queryset().prefetch_related(Prefetch('stages', queryset=stages))
        if self.request.query_params.get('archived') != 'all':
            queryset = queryset.filter(active=True, archived_at__isnull=True)
        return queryset

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())[:100]
        return Response(self.get_serializer(queryset, many=True).data)

    @transaction.atomic
    def perform_create(self, serializer):
        type(self.org).objects.select_for_update().get(pk=self.org.pk)
        if Pipeline.objects.filter(organization=self.org, active=True, archived_at__isnull=True).count() >= 100:
            raise serializers.ValidationError({'pipeline': 'A tenant may have at most 100 active pipelines.'})
        if serializer.validated_data.get('is_default', False):
            Pipeline.objects.select_for_update().filter(
                organization=self.org, is_default=True, active=True, archived_at__isnull=True
            ).update(is_default=False)
        pipeline = serializer.save(organization=self.org, created_by=self.request.user, updated_by=self.request.user)
        for order, (name, probability, stage_type, color) in enumerate(DEFAULT_STAGES):
            Stage.objects.create(
                organization=self.org, created_by=self.request.user, updated_by=self.request.user,
                pipeline=pipeline, name=name, probability=probability, stage_type=stage_type, color=color, order=order,
            )
        record_event(organization=self.org, actor=self.request.user, event_type='pipeline.created', instance=pipeline)

    @transaction.atomic
    def perform_update(self, serializer):
        type(self.org).objects.select_for_update().get(pk=self.org.pk)
        pipeline = Pipeline.objects.select_for_update().get(organization=self.org, pk=serializer.instance.pk)
        before = {'name': pipeline.name, 'is_default': pipeline.is_default, 'active': pipeline.active}
        if serializer.validated_data.get('is_default') is True:
            Pipeline.objects.filter(
                organization=self.org, is_default=True, active=True, archived_at__isnull=True
            ).exclude(pk=pipeline.pk).update(is_default=False)
        serializer.instance = pipeline
        updated = serializer.save(updated_by=self.request.user, version=F('version') + 1)
        updated.refresh_from_db()
        after = {key: getattr(updated, key) for key in before}
        record_event(
            organization=self.org, actor=self.request.user, event_type='pipeline.updated', instance=updated,
            field_diff={key: {'from': before[key], 'to': after[key]} for key in before if before[key] != after[key]},
        )

    def destroy(self, request, *args, **kwargs):
        return self.archive(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def archive(self, request, pk=None):
        pipeline = Pipeline.objects.select_for_update().filter(organization=self.org, pk=pk).first()
        if pipeline is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        active_deals = pipeline.deals.filter(archived_at__isnull=True).count()
        if active_deals:
            raise serializers.ValidationError({'pipeline': f'{active_deals} active deals must be moved first.'})
        if not Pipeline.objects.filter(
            organization=self.org, active=True, archived_at__isnull=True
        ).exclude(pk=pipeline.pk).exists():
            raise serializers.ValidationError({'pipeline': 'The only active pipeline cannot be archived.'})
        pipeline.active = pipeline.is_default = False
        pipeline.archived_at = timezone.now()
        pipeline.updated_by = request.user
        pipeline.version += 1
        pipeline.save(update_fields=['active', 'is_default', 'archived_at', 'updated_by', 'version', 'updated_at'])
        record_event(organization=self.org, actor=request.user, event_type='pipeline.archived', instance=pipeline)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def restore(self, request, pk=None):
        pipeline = Pipeline.objects.select_for_update().filter(organization=self.org, pk=pk).first()
        if pipeline is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        pipeline.active = True
        pipeline.archived_at = None
        pipeline.updated_by = request.user
        pipeline.version += 1
        pipeline.save(update_fields=['active', 'archived_at', 'updated_by', 'version', 'updated_at'])
        record_event(organization=self.org, actor=request.user, event_type='pipeline.restored', instance=pipeline)
        return Response(self.get_serializer(self.get_queryset().get(pk=pipeline.pk)).data)

    @action(detail=True, methods=['post'], url_path='reorder-stages')
    def reorder_stages_action(self, request, pk=None):
        pipeline = self.get_object()
        payload = ReorderStagesSerializer(data=request.data, context=self.get_serializer_context())
        payload.is_valid(raise_exception=True)
        stages = reorder_stages(
            pipeline=pipeline, actor=request.user, stage_ids=payload.validated_data['stage_ids'],
            expected_version=payload.validated_data.get('expected_version'),
        )
        return Response(StageSerializer(stages, many=True, context=self.get_serializer_context()).data)

    @action(detail=False, methods=['post'], url_path='reorder')
    @transaction.atomic
    def reorder_pipelines(self, request):
        pipeline_ids = request.data.get('pipeline_ids')
        if not isinstance(pipeline_ids, list) or not pipeline_ids or len(pipeline_ids) > 100:
            raise serializers.ValidationError({'pipeline_ids': 'Provide 1 to 100 pipeline ids.'})
        pipelines = list(Pipeline.objects.select_for_update().filter(
            organization=self.org, active=True, archived_at__isnull=True
        ))
        if len(pipeline_ids) != len(set(pipeline_ids)) or set(pipeline_ids) != {item.id for item in pipelines}:
            raise serializers.ValidationError({'pipeline_ids': 'Provide every active pipeline exactly once.'})
        for display_order, pipeline_id in enumerate(pipeline_ids):
            Pipeline.objects.filter(organization=self.org, pk=pipeline_id).update(
                display_order=display_order, updated_by=request.user
            )
        anchor = next(item for item in pipelines if item.id == pipeline_ids[0])
        record_event(
            organization=self.org, actor=request.user, event_type='pipeline.reordered', instance=anchor,
            metadata={'pipeline_ids': pipeline_ids},
        )
        return Response({'pipeline_ids': pipeline_ids})


class StageViewSet(TenantViewSet):
    queryset = Stage.objects.all()
    serializer_class = StageSerializer
    permission_classes = [IsAuthenticated, IsOrgMember, ConfigurationPermission]
    filterset_fields = ['pipeline', 'stage_type', 'active']
    search_fields = ['name']
    ordering_fields = ['order', 'name', 'created_at']
    ordering = ['order', 'id']

    def get_queryset(self):
        queryset = super().get_queryset().select_related('pipeline').annotate(
            deals_count=Count('deals', filter=Q(deals__archived_at__isnull=True))
        )
        return queryset if self.request.query_params.get('archived') == 'all' else queryset.filter(
            active=True, archived_at__isnull=True
        )

    @transaction.atomic
    def perform_create(self, serializer):
        if serializer.validated_data['pipeline'].stages.filter(active=True, archived_at__isnull=True).count() >= 200:
            raise serializers.ValidationError({'pipeline': 'A pipeline may contain at most 200 active stages.'})
        stage = serializer.save(organization=self.org, created_by=self.request.user, updated_by=self.request.user)
        record_event(organization=self.org, actor=self.request.user, event_type='stage.created', instance=stage)

    @transaction.atomic
    def perform_update(self, serializer):
        stage = Stage.objects.select_for_update().get(organization=self.org, pk=serializer.instance.pk)
        before = {'name': stage.name, 'probability': stage.probability, 'stage_type': stage.stage_type}
        serializer.instance = stage
        updated = serializer.save(updated_by=self.request.user)
        after = {key: getattr(updated, key) for key in before}
        record_event(
            organization=self.org, actor=self.request.user, event_type='stage.updated', instance=updated,
            field_diff={key: {'from': before[key], 'to': after[key]} for key in before if before[key] != after[key]},
        )

    def destroy(self, request, *args, **kwargs):
        return self.archive(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def archive(self, request, pk=None):
        stage = Stage.objects.select_for_update().filter(organization=self.org, pk=pk).first()
        if stage is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        deal_count = stage.deals.filter(archived_at__isnull=True).count()
        if deal_count:
            raise serializers.ValidationError({'stage': f'{deal_count} active deals must be moved first.'})
        siblings = stage.pipeline.stages.filter(
            active=True, archived_at__isnull=True, stage_type=stage.stage_type
        ).exclude(pk=stage.pk)
        if stage.stage_type in (Stage.Type.OPEN, Stage.Type.WON, Stage.Type.LOST) and not siblings.exists():
            raise serializers.ValidationError({'stage': f'Pipeline requires an active {stage.stage_type} stage.'})
        stage.active = False
        stage.archived_at = timezone.now()
        stage.updated_by = request.user
        stage.save(update_fields=['active', 'archived_at', 'updated_by', 'updated_at'])
        record_event(organization=self.org, actor=request.user, event_type='stage.archived', instance=stage)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def restore(self, request, pk=None):
        stage = Stage.objects.select_for_update().select_related('pipeline').filter(
            organization=self.org, pk=pk
        ).first()
        if stage is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not stage.pipeline.active or stage.pipeline.archived_at is not None:
            raise serializers.ValidationError({'pipeline': 'Restore the pipeline before restoring its stage.'})
        if stage.stage_type in (Stage.Type.WON, Stage.Type.LOST) and stage.pipeline.stages.filter(
            stage_type=stage.stage_type, active=True, archived_at__isnull=True
        ).exclude(pk=stage.pk).exists():
            raise serializers.ValidationError({'stage_type': 'An active terminal stage with this behavior already exists.'})
        occupied = stage.pipeline.stages.filter(order=stage.order, archived_at__isnull=True).exclude(pk=stage.pk).exists()
        if occupied:
            highest = stage.pipeline.stages.filter(archived_at__isnull=True).aggregate(value=Max('order'))['value']
            stage.order = (highest if highest is not None else -1) + 1
        stage.active = True
        stage.archived_at = None
        stage.updated_by = request.user
        stage.save(update_fields=['active', 'archived_at', 'order', 'updated_by', 'updated_at'])
        record_event(organization=self.org, actor=request.user, event_type='stage.restored', instance=stage)
        return Response(self.get_serializer(stage).data)


class LostReasonViewSet(TenantViewSet):
    queryset = LostReason.objects.all()
    serializer_class = LostReasonSerializer
    permission_classes = [IsAuthenticated, IsOrgMember, ConfigurationPermission]
    filterset_fields = ['active']
    search_fields = ['label']
    ordering_fields = ['display_order', 'label']
    ordering = ['display_order', 'id']

    @transaction.atomic
    def perform_create(self, serializer):
        type(self.org).objects.select_for_update().get(pk=self.org.pk)
        if LostReason.objects.filter(organization=self.org, active=True, archived_at__isnull=True).count() >= 100:
            raise serializers.ValidationError({'label': 'A tenant may have at most 100 active lost reasons.'})
        super().perform_create(serializer)
        record_event(organization=self.org, actor=self.request.user, event_type='lost_reason.created', instance=serializer.instance)

    def perform_update(self, serializer):
        before = serializer.instance.label
        super().perform_update(serializer)
        record_event(
            organization=self.org, actor=self.request.user, event_type='lost_reason.updated', instance=serializer.instance,
            field_diff={'label': {'from': before, 'to': serializer.instance.label}},
        )

    def destroy(self, request, *args, **kwargs):
        reason = self.get_object()
        reason.active = False
        reason.archived_at = timezone.now()
        reason.updated_by = request.user
        reason.save(update_fields=['active', 'archived_at', 'updated_by', 'updated_at'])
        record_event(organization=self.org, actor=request.user, event_type='lost_reason.archived', instance=reason)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['post'])
    @transaction.atomic
    def reorder(self, request):
        reason_ids = request.data.get('reason_ids')
        reasons = list(LostReason.objects.select_for_update().filter(
            organization=self.org, active=True, archived_at__isnull=True
        ))
        if not isinstance(reason_ids, list) or len(reason_ids) != len(set(reason_ids)) or set(reason_ids) != {
            item.id for item in reasons
        }:
            raise serializers.ValidationError({'reason_ids': 'Provide every active lost reason exactly once.'})
        for display_order, reason_id in enumerate(reason_ids):
            LostReason.objects.filter(organization=self.org, pk=reason_id).update(
                display_order=display_order, updated_by=request.user
            )
        if reasons:
            record_event(
                organization=self.org, actor=request.user, event_type='lost_reason.reordered', instance=reasons[0],
                metadata={'reason_ids': reason_ids},
            )
        return Response({'reason_ids': reason_ids})


class ProductViewSet(TenantViewSet):
    queryset = Product.objects.all()
    serializer_class = ProductSerializer
    permission_classes = [IsAuthenticated, IsOrgMember, ConfigurationPermission]
    filterset_fields = ['active', 'currency']
    search_fields = ['name', 'sku']
    ordering_fields = ['name', 'sku', 'default_price', 'created_at']
    ordering = ['name', 'id']

    def perform_create(self, serializer):
        super().perform_create(serializer)
        record_event(organization=self.org, actor=self.request.user, event_type='product.created', instance=serializer.instance)

    def get_queryset(self):
        queryset = super().get_queryset()
        return queryset if self.request.query_params.get('archived') == 'all' else queryset.filter(archived_at__isnull=True)

    def destroy(self, request, *args, **kwargs):
        product = self.get_object()
        product.active = False
        product.archived_at = timezone.now()
        product.updated_by = request.user
        product.save(update_fields=['active', 'archived_at', 'updated_by', 'updated_at'])
        record_event(organization=self.org, actor=request.user, event_type='product.archived', instance=product)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @transaction.atomic
    def perform_update(self, serializer):
        before = serializer.instance.default_price
        super().perform_update(serializer)
        if before != serializer.instance.default_price:
            record_event(
                organization=self.org, actor=self.request.user, event_type='product.price_changed',
                instance=serializer.instance,
                field_diff={'default_price': {'from': before, 'to': serializer.instance.default_price}},
            )


class DealViewSet(CustomerRecordViewSetMixin, TenantViewSet):
    queryset = Deal.objects.all()
    serializer_class = DealSerializer
    permission_classes = [IsAuthenticated, IsOrgMember, DealPermission]
    custom_target = 'deal'
    event_prefix = 'deal'
    filterset_class = DealFilter
    filter_backends = (DjangoFilterBackend, NormalizedSearchFilter, StableOrderingFilter)
    search_fields = [
        'title', 'normalized_title', 'company__name', 'company__normalized_name',
        'contact__display_name', 'contact__normalized_name', 'contact__email',
        'owner__first_name', 'owner__last_name', 'line_items__name_snapshot',
    ]
    ordering_fields = [
        'value', 'probability_override', 'created_at', 'updated_at', 'expected_close_date',
        'title', 'owner__first_name', 'stage__order', 'effective_probability_sort', 'weighted_amount_sort',
    ]
    ordering = ['-created_at', '-id']

    def get_queryset(self):
        queryset = (
            super().get_queryset().select_related(
                'pipeline', 'stage', 'contact', 'company', 'source_lead', 'owner', 'team', 'lost_reason_record'
            ).prefetch_related('tags').annotate(
                effective_probability_sort=effective_probability_expression(),
                weighted_amount_sort=weighted_expression(),
                participants_count=Count('participants', distinct=True),
                line_items_count=Count('line_items', distinct=True),
            )
        )
        return annotate_activity_summary(queryset, 'deal')

    def _transition(self, request, destination, *, reopening=False, abandoning=False):
        deal = self.get_object()
        data = {**request.data, 'stage': destination.pk}
        legacy_reason = data.get('lost_reason')
        if destination.stage_type == Stage.Type.LOST and isinstance(legacy_reason, str) and not legacy_reason.isdigit():
            other = LostReason.objects.filter(
                organization=self.org, normalized_label='other', active=True, archived_at__isnull=True
            ).first()
            data['lost_reason'] = other.pk if other else None
            data.setdefault('lost_reason_text', legacy_reason)
        payload = MoveDealSerializer(
            data=data, context=self.get_serializer_context()
        )
        payload.is_valid(raise_exception=True)
        moved = move_deal(
            deal=deal, destination_stage=destination, actor=request.user,
            expected_version=payload.validated_data.get('expected_version'),
            lost_reason=payload.validated_data.get('lost_reason'),
            lost_reason_text=payload.validated_data.get('lost_reason_text', ''),
            actual_close_date=payload.validated_data.get('actual_close_date'), reopening=reopening,
            abandoning=abandoning,
        )
        return Response(self.get_serializer(self.get_queryset().get(pk=moved.pk)).data)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def restore(self, request, pk=None):
        deal = Deal.objects.select_for_update().select_related('pipeline', 'stage').filter(
            organization=self.org, pk=pk
        ).first()
        if deal is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        self.check_object_permissions(request, deal)
        if not deal.pipeline.active or deal.pipeline.archived_at is not None:
            raise serializers.ValidationError({'pipeline': 'Restore the Deal pipeline first.'})
        if not deal.stage.active or deal.stage.archived_at is not None:
            raise serializers.ValidationError({'stage': 'Restore the Deal stage first.'})
        return super().restore(request, pk)

    @action(detail=True, methods=['post'], url_path='move-stage')
    def move_stage(self, request, pk=None):
        payload = MoveDealSerializer(data=request.data, context=self.get_serializer_context())
        payload.is_valid(raise_exception=True)
        destination = payload.validated_data['stage']
        if destination.pipeline_id != self.get_object().pipeline_id:
            raise serializers.ValidationError({'stage': 'Use move-pipeline for a different pipeline.'})
        return self._transition(request, destination)

    @action(detail=True, methods=['post'], url_path='move-pipeline')
    def move_pipeline(self, request, pk=None):
        payload = MoveDealSerializer(data=request.data, context=self.get_serializer_context())
        payload.is_valid(raise_exception=True)
        return self._transition(request, payload.validated_data['stage'])

    @action(detail=True, methods=['post'], url_path='move')
    def move(self, request, pk=None):
        return self.move_stage(request, pk)

    @action(detail=True, methods=['post'], url_path='mark-won')
    def mark_won(self, request, pk=None):
        deal = self.get_object()
        stage = deal.pipeline.stages.filter(stage_type=Stage.Type.WON, active=True, archived_at__isnull=True).first()
        if stage is None:
            raise serializers.ValidationError({'pipeline': 'Pipeline has no active won stage.'})
        return self._transition(request, stage)

    @action(detail=True, methods=['post'], url_path='mark-lost')
    def mark_lost(self, request, pk=None):
        deal = self.get_object()
        stage = deal.pipeline.stages.filter(stage_type=Stage.Type.LOST, active=True, archived_at__isnull=True).first()
        if stage is None:
            raise serializers.ValidationError({'pipeline': 'Pipeline has no active lost stage.'})
        return self._transition(request, stage)

    @action(detail=True, methods=['post'], url_path='mark-abandoned')
    def mark_abandoned(self, request, pk=None):
        deal = self.get_object()
        stage = deal.pipeline.stages.filter(stage_type=Stage.Type.LOST, active=True, archived_at__isnull=True).first()
        if stage is None:
            raise serializers.ValidationError({'pipeline': 'Pipeline has no active lost stage.'})
        return self._transition(request, stage, abandoning=True)

    @action(detail=True, methods=['post'])
    def reopen(self, request, pk=None):
        deal = self.get_object()
        payload = ReopenDealSerializer(data=request.data, context=self.get_serializer_context())
        payload.is_valid(raise_exception=True)
        return self._transition(request, payload.validated_data['stage'], reopening=True)

    @action(detail=True, methods=['get', 'post'], url_path='contacts')
    def contacts(self, request, pk=None):
        deal = self.get_object()
        if request.method == 'GET':
            queryset = deal.participants.select_related('contact').order_by('-is_primary', 'id')
            page = self.paginate_queryset(queryset)
            return self.get_paginated_response(DealContactSerializer(page, many=True).data)
        payload = ParticipantInputSerializer(data=request.data, context=self.get_serializer_context())
        payload.is_valid(raise_exception=True)
        participant = add_participant(deal=deal, actor=request.user, **payload.validated_data)
        return Response(DealContactSerializer(participant).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path=r'contacts/(?P<participant_id>\d+)')
    @transaction.atomic
    def remove_contact(self, request, pk=None, participant_id=None):
        deal = self.get_object()
        participant = DealContact.objects.select_for_update().filter(
            organization=self.org, deal=deal, pk=participant_id
        ).first()
        if participant is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        contact_id = participant.contact_id
        participant.delete()
        if deal.contact_id == contact_id:
            replacement = deal.participants.filter(is_primary=True).first() or deal.participants.first()
            deal.contact = replacement.contact if replacement else None
            deal.updated_by = request.user
            deal.version += 1
            deal.save(update_fields=['contact', 'updated_by', 'version', 'updated_at'])
        record_event(
            organization=self.org, actor=request.user, event_type='deal.contact_removed', instance=deal,
            metadata={'contact_id': contact_id},
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['get', 'post'], url_path='line-items')
    def line_items(self, request, pk=None):
        deal = self.get_object()
        if request.method == 'GET':
            queryset = deal.line_items.select_related('product').order_by('position', 'id')
            page = self.paginate_queryset(queryset)
            return self.get_paginated_response(DealLineItemSerializer(page, many=True).data)
        payload = LineItemInputSerializer(data=request.data, context={**self.get_serializer_context(), 'deal': deal})
        payload.is_valid(raise_exception=True)
        return Response(DealLineItemSerializer(payload.save()).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['patch', 'delete'], url_path=r'line-items/(?P<item_id>\d+)')
    def line_item(self, request, pk=None, item_id=None):
        deal = self.get_object()
        item = DealLineItem.objects.filter(organization=self.org, deal=deal, pk=item_id).first()
        if item is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if request.method == 'DELETE':
            delete_line_item(item=item, actor=request.user)
            return Response(status=status.HTTP_204_NO_CONTENT)
        payload = LineItemInputSerializer(
            item, data=request.data, partial=True, context={**self.get_serializer_context(), 'deal': deal}
        )
        payload.is_valid(raise_exception=True)
        return Response(DealLineItemSerializer(payload.save()).data)

    @action(detail=True, methods=['get'], url_path='stage-history')
    def stage_history(self, request, pk=None):
        queryset = self.get_object().stage_history.select_related(
            'from_stage', 'to_stage', 'pipeline', 'actor'
        ).order_by('-entered_at', '-id')
        page = self.paginate_queryset(queryset)
        return self.get_paginated_response(DealStageHistorySerializer(page, many=True).data)

    @action(detail=False, methods=['get'])
    def board(self, request):
        pipeline = Pipeline.objects.filter(
            organization=self.org, pk=request.query_params.get('pipeline'), active=True, archived_at__isnull=True
        ).first()
        if pipeline is None:
            raise serializers.ValidationError({'pipeline': 'Select an active tenant pipeline.'})
        try:
            limit = min(max(int(request.query_params.get('limit', 25)), 1), 50)
        except (TypeError, ValueError):
            raise serializers.ValidationError({'limit': 'Use a number from 1 to 50.'})
        active_stages = list(pipeline.stages.filter(active=True, archived_at__isnull=True).order_by('order', 'id'))
        limit = min(limit, max(1, 1000 // max(len(active_stages), 1)))
        queryset = self.filter_queryset(self.get_queryset().filter(pipeline=pipeline, archived_at__isnull=True))
        filtered_ids = queryset.order_by().values('pk')
        summary_queryset = Deal.objects.filter(organization=self.org, pk__in=Subquery(filtered_ids))
        summaries = list(summary_queryset.order_by().values('stage_id', 'currency').annotate(
            count=Count('id'), total_value=Sum('value'), weighted_value=Sum(weighted_expression())
        ))
        for summary in summaries:
            summary['value'] = summary.pop('total_value')
        cards = queryset.annotate(
            _stage_rank=Window(RowNumber(), partition_by=[F('stage_id')], order_by=[F('updated_at').desc(), F('id').desc()])
        ).filter(_stage_rank__lte=limit).order_by('stage__order', '-updated_at', '-id')
        cards = list(cards)
        prime_custom_fields(cards, self.custom_target)
        grouped = defaultdict(list)
        for card in self.get_serializer(cards, many=True).data:
            grouped[card['stage']].append(card)
        columns = []
        for stage in active_stages:
            totals = [row for row in summaries if row['stage_id'] == stage.id]
            columns.append({
                'stage': StageSerializer(stage).data, 'deals': grouped[stage.id], 'totals': totals,
                'has_more': any(row['count'] > limit for row in totals),
            })
        return Response({'pipeline': PipelineSerializer(pipeline).data, 'columns': columns, 'limit': limit})

    @action(detail=False, methods=['post'])
    @transaction.atomic
    def bulk(self, request):
        ids, operation = request.data.get('ids'), request.data.get('operation')
        if not isinstance(ids, list) or not ids or len(ids) > self.bulk_limit or len(ids) != len(set(ids)):
            raise serializers.ValidationError({'ids': f'Provide 1 to {self.bulk_limit} unique deal ids.'})
        deals = list(Deal.objects.select_for_update().filter(organization=self.org, id__in=ids))
        if len(deals) != len(ids):
            raise serializers.ValidationError({'ids': 'One or more deals are unavailable.'})
        if operation in ('change_stage', 'move_pipeline'):
            destination = Stage.objects.filter(
                organization=self.org, active=True, archived_at__isnull=True, pk=request.data.get('stage')
            ).first()
            if destination is None:
                raise serializers.ValidationError({'stage': 'Destination stage is unavailable.'})
            reason = LostReason.objects.filter(organization=self.org, pk=request.data.get('lost_reason')).first()
            for deal in deals:
                if operation == 'change_stage' and destination.pipeline_id != deal.pipeline_id:
                    raise serializers.ValidationError({'stage': 'Stage must belong to every deal pipeline.'})
                move_deal(
                    deal=deal, destination_stage=destination, actor=request.user, lost_reason=reason,
                    lost_reason_text=request.data.get('lost_reason_text', ''),
                )
        elif operation in ('assign_owner', 'assign_team', 'change_priority', 'archive', 'restore'):
            if operation == 'assign_owner':
                field, value = 'owner_id', request.data.get('owner_id')
                if value and not Membership.objects.filter(organization=self.org, user_id=value, is_active=True).exists():
                    raise serializers.ValidationError({'owner_id': 'Owner is not an active tenant member.'})
            elif operation == 'assign_team':
                field, value = 'team_id', request.data.get('team_id')
                if value and not Team.objects.filter(organization=self.org, pk=value, active=True).exists():
                    raise serializers.ValidationError({'team_id': 'Team is unavailable.'})
            elif operation == 'change_priority':
                field, value = 'priority', request.data.get('priority')
                if value not in Deal.Priority.values:
                    raise serializers.ValidationError({'priority': 'Invalid priority.'})
            else:
                field, value = 'archived_at', timezone.now() if operation == 'archive' else None
            for deal in deals:
                before = getattr(deal, field)
                setattr(deal, field, value)
                deal.updated_by, deal.version = request.user, deal.version + 1
                deal.save(update_fields=[field, 'updated_by', 'version', 'updated_at'])
                event_type = {
                    'assign_owner': 'deal.owner_changed',
                    'assign_team': 'deal.team_changed',
                    'change_priority': 'deal.priority_changed',
                    'archive': 'deal.archived',
                    'restore': 'deal.restored',
                }[operation]
                record_event(
                    organization=self.org, actor=request.user, event_type=event_type, instance=deal,
                    metadata={'bulk': True, 'bulk_size': len(deals)},
                    field_diff={field: {'from': before, 'to': value}},
                )
        elif operation in ('add_tags', 'remove_tags'):
            return super().bulk(request)
        else:
            raise serializers.ValidationError({'operation': 'Unsupported bulk Deal operation.'})
        return Response({'updated': len(deals), 'ids': ids})


class PipelineAnalyticsViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated, IsOrgMember, DealPermission]

    def list(self, request):
        membership = get_membership(request)
        filters = _report_filters(request, include_dates=True, include_tags=True)
        return Response(pipeline_analytics(membership.organization, filters))


class ForecastViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated, IsOrgMember, DealPermission]

    def list(self, request):
        period = request.query_params.get('period', 'month')
        if period not in ('month', 'quarter', 'custom'):
            raise serializers.ValidationError({'period': 'Use month, quarter, or custom.'})
        membership = get_membership(request)
        filters = _report_filters(request)
        if period == 'custom':
            start = parse_date(request.query_params.get('date_from', ''))
            end = parse_date(request.query_params.get('date_to', ''))
            if start is None or end is None or start > end:
                raise serializers.ValidationError({'date_range': 'Custom forecasts require a valid date_from and date_to.'})
            filters.update(forecast_from=start, forecast_to=end)
        return Response({'period': period, 'results': forecast(membership.organization, filters, period)})


def _report_filters(request, *, include_dates=False, include_tags=False):
    filters = {}
    for key in ('pipeline', 'owner', 'team', 'company'):
        raw = request.query_params.get(key)
        if raw in (None, ''):
            continue
        try:
            value = int(raw)
        except (TypeError, ValueError) as exc:
            raise serializers.ValidationError({key: 'Use a positive integer id.'}) from exc
        if value <= 0:
            raise serializers.ValidationError({key: 'Use a positive integer id.'})
        filters[key] = value
    source = request.query_params.get('source')
    if source:
        if len(source) > 80:
            raise serializers.ValidationError({'source': 'Source may not exceed 80 characters.'})
        filters['source'] = source
    if include_dates:
        for key in ('date_from', 'date_to'):
            raw = request.query_params.get(key)
            if raw:
                value = parse_date(raw)
                if value is None:
                    raise serializers.ValidationError({key: 'Use an ISO date.'})
                filters[key] = value
    if include_tags:
        tags = request.query_params.getlist('tags')
        try:
            filters['tags'] = [int(tag) for tag in tags]
        except (TypeError, ValueError) as exc:
            raise serializers.ValidationError({'tags': 'Use integer tag ids.'}) from exc
        if any(tag <= 0 for tag in filters['tags']) or len(filters['tags']) > 50:
            raise serializers.ValidationError({'tags': 'Use at most 50 positive tag ids.'})
    return filters

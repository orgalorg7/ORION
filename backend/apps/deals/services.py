from decimal import Decimal

from django.db import transaction
from django.db.models import F, Sum
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import APIException

from apps.customer_core.events import record_event

from .models import Deal, DealContact, DealLineItem, DealStageHistory, LostReason, Pipeline, Product, Stage


class VersionConflict(APIException):
    status_code = 409
    default_code = 'version_conflict'
    default_detail = 'This deal changed after it was loaded. Refresh and try again.'


def _check_version(instance, expected_version):
    if expected_version is not None and instance.version != expected_version:
        raise VersionConflict()


def create_initial_history(deal, actor):
    if not DealStageHistory.objects.filter(
        organization=deal.organization, deal=deal, exited_at__isnull=True
    ).exists():
        DealStageHistory.objects.create(
            organization=deal.organization, deal=deal,
            created_by=actor, updated_by=actor, actor=actor, pipeline=deal.pipeline,
            from_stage=None, to_stage=deal.stage, entered_at=deal.stage_entered_at,
        )


def _terminal_fields(
    deal, destination, now, *, lost_reason=None, lost_reason_text='', actual_close_date=None, abandoning=False,
):
    if destination.stage_type == Stage.Type.WON:
        deal.status = Deal.Status.WON
        deal.won_at = now
        deal.closed_at = now
        deal.actual_close_date = actual_close_date or timezone.localdate()
        deal.forecast_category = Deal.ForecastCategory.CLOSED
        deal.lost_reason_record = None
        deal.lost_reason = ''
        deal.lost_reason_text = ''
    elif destination.stage_type == Stage.Type.LOST:
        if deal.pipeline.require_lost_reason and lost_reason is None:
            raise serializers.ValidationError({'lost_reason': 'Select a lost reason.'})
        if lost_reason and (lost_reason.organization_id != deal.organization_id or not lost_reason.active):
            raise serializers.ValidationError({'lost_reason': 'Lost reason is unavailable.'})
        deal.status = Deal.Status.ABANDONED if abandoning else Deal.Status.LOST
        if abandoning:
            deal.abandoned_at = now
        else:
            deal.lost_at = now
        deal.closed_at = now
        deal.actual_close_date = actual_close_date or timezone.localdate()
        deal.forecast_category = Deal.ForecastCategory.CLOSED
        deal.lost_reason_record = lost_reason
        deal.lost_reason = lost_reason.label if lost_reason else 'Other'
        deal.lost_reason_text = lost_reason_text
    else:
        deal.status = Deal.Status.OPEN
        deal.closed_at = None
        deal.actual_close_date = None
        deal.lost_reason_record = None
        deal.lost_reason = ''
        deal.lost_reason_text = ''
        if deal.forecast_category == Deal.ForecastCategory.CLOSED:
            deal.forecast_category = Deal.ForecastCategory.PIPELINE


@transaction.atomic
def move_deal(
    *, actor, destination_stage, deal=None, deal_id=None, organization=None, expected_version=None,
    lost_reason=None, lost_reason_text='', actual_close_date=None, reopening=False, abandoning=False,
):
    if deal is not None:
        deal_id = deal.pk
        organization = deal.organization
    if deal_id is None or organization is None:
        raise TypeError('move_deal requires a tenant-scoped deal or deal_id and organization.')
    deal = (
        Deal.objects.select_for_update(of=('self',))
        .select_related('pipeline', 'stage', 'lost_reason_record')
        .filter(organization=organization, pk=deal_id, archived_at__isnull=True)
        .first()
    )
    if deal is None:
        raise serializers.ValidationError({'deal': 'Deal was not found.'})
    _check_version(deal, expected_version)
    destination = Stage.objects.select_for_update().select_related('pipeline').filter(
        organization=organization,
        pk=destination_stage.pk,
        active=True,
        archived_at__isnull=True,
        pipeline__active=True,
        pipeline__archived_at__isnull=True,
    ).first()
    if destination is None:
        raise serializers.ValidationError({'stage': 'Destination stage is unavailable.'})
    terminal_statuses = (Deal.Status.WON, Deal.Status.LOST, Deal.Status.ABANDONED)
    if abandoning and destination.stage_type != Stage.Type.LOST:
        raise serializers.ValidationError({'stage': 'Abandoned deals must use a lost terminal stage.'})
    if deal.status in terminal_statuses and destination.stage_type in (
        Stage.Type.OPEN, Stage.Type.ON_HOLD
    ) and not reopening:
        raise serializers.ValidationError({'detail': 'Use the reopen action for terminal deals.'})
    if deal.status in terminal_statuses and destination.stage_type in (
        Stage.Type.WON, Stage.Type.LOST
    ) and not (deal.status == Deal.Status.ABANDONED and abandoning) and destination.stage_type != deal.status:
        raise serializers.ValidationError({'detail': 'Reopen the deal before changing its terminal outcome.'})
    if deal.stage_id == destination.id and deal.pipeline_id == destination.pipeline_id:
        return deal

    now = timezone.now()
    old_pipeline_id = deal.pipeline_id
    old_stage_id = deal.stage_id
    old_status = deal.status
    DealStageHistory.objects.select_for_update().filter(
        organization=organization, deal=deal, exited_at__isnull=True
    ).update(exited_at=now, updated_by=actor)
    deal.pipeline = destination.pipeline
    deal.stage = destination
    deal.stage_entered_at = now
    deal.version = F('version') + 1
    deal.updated_by = actor
    _terminal_fields(
        deal, destination, now, lost_reason=lost_reason,
        lost_reason_text=lost_reason_text, actual_close_date=actual_close_date, abandoning=abandoning,
    )
    deal.save(update_fields=[
        'pipeline', 'stage', 'stage_entered_at', 'status', 'closed_at', 'actual_close_date',
        'won_at', 'lost_at', 'abandoned_at', 'forecast_category', 'lost_reason_record', 'lost_reason',
        'lost_reason_text', 'version', 'updated_by', 'updated_at',
    ])
    deal.refresh_from_db()
    DealStageHistory.objects.create(
        organization=organization,
        created_by=actor,
        updated_by=actor,
        actor=actor,
        deal=deal,
        pipeline=destination.pipeline,
        from_stage_id=old_stage_id,
        to_stage=destination,
        entered_at=now,
    )
    metadata = {
        'deal_id': deal.id,
        'pipeline_id': destination.pipeline_id,
        'from_pipeline_id': old_pipeline_id,
        'to_pipeline_id': destination.pipeline_id,
        'from_stage_id': old_stage_id,
        'to_stage_id': destination.id,
        'actor_id': actor.id,
    }
    record_event(
        organization=organization, actor=actor, event_type='deal.stage_changed', instance=deal,
        metadata=metadata,
        field_diff={'stage_id': {'from': old_stage_id, 'to': destination.id}},
    )
    if old_pipeline_id != destination.pipeline_id:
        record_event(
            organization=organization, actor=actor, event_type='deal.pipeline_changed', instance=deal,
            metadata=metadata,
            field_diff={'pipeline_id': {'from': old_pipeline_id, 'to': destination.pipeline_id}},
        )
    if destination.stage_type == Stage.Type.WON and old_status != Deal.Status.WON:
        record_event(organization=organization, actor=actor, event_type='deal.won', instance=deal, metadata=metadata)
    elif destination.stage_type == Stage.Type.LOST and abandoning and old_status != Deal.Status.ABANDONED:
        metadata['lost_reason_id'] = lost_reason.id if lost_reason else None
        record_event(
            organization=organization, actor=actor, event_type='deal.abandoned', instance=deal, metadata=metadata
        )
    elif destination.stage_type == Stage.Type.LOST and old_status != Deal.Status.LOST:
        metadata['lost_reason_id'] = lost_reason.id if lost_reason else None
        record_event(organization=organization, actor=actor, event_type='deal.lost', instance=deal, metadata=metadata)
    if reopening:
        deal.reopened_at = now
        deal.save(update_fields=['reopened_at', 'updated_at'])
        record_event(
            organization=organization, actor=actor, event_type='deal.reopened', instance=deal,
            metadata={**metadata, 'previous_outcome': old_status},
        )
    return deal


@transaction.atomic
def reorder_stages(*, pipeline, actor, stage_ids, expected_version=None):
    locked = Pipeline.objects.select_for_update().get(organization=pipeline.organization, pk=pipeline.pk)
    if expected_version is not None and locked.version != expected_version:
        raise VersionConflict('Pipeline configuration changed. Refresh and try again.')
    stages = list(Stage.objects.select_for_update().filter(
        organization=pipeline.organization, pipeline=locked, active=True, archived_at__isnull=True
    ))
    if set(stage_ids) != {stage.id for stage in stages} or len(stage_ids) != len(stages):
        raise serializers.ValidationError({'stage_ids': 'Provide every active stage exactly once.'})
    Stage.objects.filter(pk__in=stage_ids).update(order=F('order') + 1000000)
    for order, stage_id in enumerate(stage_ids):
        Stage.objects.filter(pk=stage_id).update(order=order, updated_by=actor)
    locked.version = F('version') + 1
    locked.updated_by = actor
    locked.save(update_fields=['version', 'updated_by', 'updated_at'])
    locked.refresh_from_db()
    record_event(
        organization=locked.organization, actor=actor, event_type='stage.reordered', instance=locked,
        metadata={'pipeline_id': locked.id, 'stage_ids': stage_ids},
    )
    return list(locked.stages.filter(active=True, archived_at__isnull=True).order_by('order', 'id'))


@transaction.atomic
def save_line_item(*, deal, actor, data, instance=None):
    locked_deal = Deal.objects.select_for_update().get(organization=deal.organization, pk=deal.pk)
    product = data.get('product') or (instance.product if instance else None)
    if product and product.organization_id != deal.organization_id:
        raise serializers.ValidationError({'product': 'Product belongs to another tenant.'})
    if instance is None:
        if product:
            data['name_snapshot'] = product.name
            data['sku_snapshot'] = product.sku
        if product and data.get('unit_price') is None:
            if product.currency != locked_deal.currency:
                raise serializers.ValidationError({'unit_price': 'Enter a price in the deal currency.'})
            data['unit_price'] = product.default_price
        instance = DealLineItem(
            organization=deal.organization, created_by=actor, updated_by=actor, deal=locked_deal, **data
        )
        event_type = 'deal.product_added'
    else:
        instance = DealLineItem.objects.select_for_update().get(
            organization=deal.organization, deal=locked_deal, pk=instance.pk
        )
        for field, value in data.items():
            setattr(instance, field, value)
        instance.updated_by = actor
        event_type = 'deal.product_updated'
    instance.full_clean()
    instance.save()
    if locked_deal.value_mode == Deal.ValueMode.LINE_ITEMS:
        total = locked_deal.line_items.aggregate(total=Sum('line_total'))['total'] or Decimal('0')
        locked_deal.value = total
        locked_deal.version = F('version') + 1
        locked_deal.updated_by = actor
        locked_deal.save(update_fields=['value', 'version', 'updated_by', 'updated_at'])
    record_event(
        organization=deal.organization, actor=actor, event_type=event_type, instance=locked_deal,
        metadata={'line_item_id': instance.id, 'product_id': instance.product_id},
    )
    return instance


@transaction.atomic
def delete_line_item(*, actor, line_item=None, item=None):
    line_item = line_item or item
    if line_item is None:
        raise TypeError('delete_line_item requires a line item.')
    deal = Deal.objects.select_for_update().get(organization=line_item.organization, pk=line_item.deal_id)
    metadata = {'line_item_id': line_item.id, 'product_id': line_item.product_id}
    line_item.delete()
    if deal.value_mode == Deal.ValueMode.LINE_ITEMS:
        deal.value = deal.line_items.aggregate(total=Sum('line_total'))['total'] or Decimal('0')
        deal.version = F('version') + 1
        deal.updated_by = actor
        deal.save(update_fields=['value', 'version', 'updated_by', 'updated_at'])
    record_event(
        organization=deal.organization, actor=actor, event_type='deal.product_removed', instance=deal,
        metadata=metadata,
    )


@transaction.atomic
def add_participant(*, deal, contact, role, is_primary, actor):
    deal = Deal.objects.select_for_update().get(organization=deal.organization, pk=deal.pk)
    if contact.organization_id != deal.organization_id:
        raise serializers.ValidationError({'contact': 'Contact belongs to another tenant.'})
    if is_primary:
        DealContact.objects.filter(deal=deal, is_primary=True).update(is_primary=False, updated_by=actor)
    participant, _ = DealContact.objects.update_or_create(
        organization=deal.organization, deal=deal, contact=contact, role=role,
        defaults={'is_primary': is_primary, 'created_by': actor, 'updated_by': actor},
    )
    if is_primary:
        deal.contact = contact
        deal.updated_by = actor
        deal.save(update_fields=['contact', 'updated_by', 'updated_at'])
    record_event(
        organization=deal.organization, actor=actor, event_type='deal.contact_added', instance=deal,
        metadata={'contact_id': contact.id, 'role': role, 'is_primary': is_primary},
    )
    return participant

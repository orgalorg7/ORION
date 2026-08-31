import re
import unicodedata

from django.db import migrations
from django.utils.text import slugify


LOST_REASONS = (
    'Price', 'Competitor', 'No Budget', 'Timing', 'No Response',
    'Requirements Changed', 'Internal Decision', 'Duplicate', 'Other',
)


def normalized(value):
    value = unicodedata.normalize('NFKC', str(value or '')).casefold().strip()
    return re.sub(r'\s+', ' ', value)


def forwards(apps, schema_editor):
    Pipeline = apps.get_model('deals', 'Pipeline')
    Stage = apps.get_model('deals', 'Stage')
    Deal = apps.get_model('deals', 'Deal')
    History = apps.get_model('deals', 'DealStageHistory')
    Participant = apps.get_model('deals', 'DealContact')
    LostReason = apps.get_model('deals', 'LostReason')
    ObjectType = apps.get_model('customer_core', 'ObjectTypeDefinition')

    org_ids = set(Pipeline.objects.values_list('organization_id', flat=True))
    org_ids.update(Deal.objects.values_list('organization_id', flat=True))

    for organization_id in org_ids:
        pipelines = list(Pipeline.objects.filter(organization_id=organization_id).order_by('id'))
        default_seen = False
        used_keys = set()
        for display_order, pipeline in enumerate(pipelines):
            base = slugify(pipeline.name)[:90] or f'pipeline-{pipeline.pk}'
            key = base
            suffix = 2
            while key in used_keys:
                key = f'{base[:90]}-{suffix}'
                suffix += 1
            used_keys.add(key)
            if pipeline.is_default and not default_seen:
                default_seen = True
            elif pipeline.is_default:
                pipeline.is_default = False
            pipeline.key = key
            pipeline.display_order = display_order
            pipeline.save(update_fields=['key', 'display_order', 'is_default'])

            stages = list(Stage.objects.filter(pipeline_id=pipeline.id).order_by('order', 'id'))
            open_stages = []
            won_stage = lost_stage = None
            for order, stage in enumerate(stages):
                name = normalized(stage.name)
                if name in ('won', 'closed won', 'signed contract') and won_stage is None:
                    stage.stage_type, stage.probability = 'won', 100
                    won_stage = stage
                elif name in ('lost', 'closed lost') and lost_stage is None:
                    stage.stage_type, stage.probability = 'lost', 0
                    lost_stage = stage
                else:
                    stage.stage_type = 'open'
                    open_stages.append(stage)
                stage.order = order
                stage.save(update_fields=['stage_type', 'probability', 'order'])
            if not open_stages:
                open_stages.append(Stage.objects.create(
                    organization_id=organization_id, pipeline_id=pipeline.id, name='New', order=0,
                    probability=10, stage_type='open', color='#64748b', created_by_id=pipeline.created_by_id,
                    updated_by_id=pipeline.updated_by_id,
                ))
            next_order = Stage.objects.filter(pipeline_id=pipeline.id).count()
            if won_stage is None:
                won_stage = Stage.objects.create(
                    organization_id=organization_id, pipeline_id=pipeline.id, name='Won', order=next_order,
                    probability=100, stage_type='won', color='#10b981', created_by_id=pipeline.created_by_id,
                    updated_by_id=pipeline.updated_by_id,
                )
                next_order += 1
            if lost_stage is None:
                lost_stage = Stage.objects.create(
                    organization_id=organization_id, pipeline_id=pipeline.id, name='Lost', order=next_order,
                    probability=0, stage_type='lost', color='#ef4444', created_by_id=pipeline.created_by_id,
                    updated_by_id=pipeline.updated_by_id,
                )

            first_open = open_stages[0]
            for deal in Deal.objects.filter(pipeline_id=pipeline.id).iterator(chunk_size=500):
                if deal.status == 'won':
                    deal.stage_id = won_stage.id
                    deal.won_at = deal.closed_at or deal.updated_at
                    deal.actual_close_date = (deal.closed_at or deal.updated_at).date()
                elif deal.status == 'lost':
                    deal.stage_id = lost_stage.id
                    deal.lost_at = deal.closed_at or deal.updated_at
                    deal.lost_reason_text = deal.lost_reason
                elif not deal.stage_id:
                    deal.stage_id = first_open.id
                deal.normalized_title = normalized(deal.title)
                deal.stage_entered_at = deal.updated_at
                deal.save(update_fields=[
                    'stage', 'won_at', 'lost_at', 'actual_close_date', 'lost_reason_text',
                    'normalized_title', 'stage_entered_at',
                ])
                History.objects.get_or_create(
                    organization_id=organization_id, deal_id=deal.id, exited_at__isnull=True,
                    defaults={
                        'pipeline_id': pipeline.id, 'to_stage_id': deal.stage_id,
                        'entered_at': deal.created_at, 'actor_id': deal.created_by_id,
                        'created_by_id': deal.created_by_id, 'updated_by_id': deal.updated_by_id,
                    },
                )
                if deal.contact_id:
                    Participant.objects.get_or_create(
                        organization_id=organization_id, deal_id=deal.id, contact_id=deal.contact_id,
                        role='primary', defaults={
                            'is_primary': True, 'created_by_id': deal.created_by_id,
                            'updated_by_id': deal.updated_by_id,
                        },
                    )

        for order, label in enumerate(LOST_REASONS):
            LostReason.objects.get_or_create(
                organization_id=organization_id, normalized_label=normalized(label),
                defaults={'label': label, 'display_order': order},
            )
        ObjectType.objects.get_or_create(
            organization_id=organization_id, key='deal',
            defaults={'label': 'Deal', 'system': True, 'active': True},
        )


class Migration(migrations.Migration):
    dependencies = [
        ('deals', '0003_dealcontact_deallineitem_dealstagehistory_lostreason_and_more'),
        ('customer_core', '0005_seed_object_types'),
    ]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]

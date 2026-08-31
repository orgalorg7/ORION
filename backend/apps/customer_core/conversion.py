from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.activities.models import Activity, Note
from apps.contacts.models import Company, Contact
from apps.deals.models import Deal, Pipeline, Stage
from apps.deals.services import add_participant, create_initial_history
from apps.leads.models import Lead

from .custom_fields import custom_fields_for, set_custom_fields, validate_custom_fields
from .duplicates import DuplicateConflict, DuplicateDetectionService
from .events import record_event


def _copy_custom_fields(source, target, source_type, target_type, actor, require_all=False, preserve_existing=False):
    raw = custom_fields_for(source, source_type)
    existing = custom_fields_for(target, target_type) if preserve_existing else {}
    allowed_payload = {}
    from .models import CustomFieldDefinition

    target_keys = set(
        CustomFieldDefinition.objects.filter(
            organization=source.organization, target_object=target_type, active=True
        ).values_list('key', flat=True)
    )
    for key, value in raw.items():
        if key in target_keys and key not in existing:
            allowed_payload[key] = value
    if allowed_payload or require_all:
        values, definitions = validate_custom_fields(
            organization=source.organization, target_object=target_type, payload=allowed_payload, require_all=require_all
        )
        set_custom_fields(
            instance=target, target_object=target_type, values=values, definitions=definitions, actor=actor
        )


@transaction.atomic
def convert_lead(*, lead_id, organization, actor, data):
    lead = (
        Lead.objects.select_for_update(of=('self',))
        .select_related('owner', 'team', 'company')
        .filter(organization=organization, pk=lead_id)
        .first()
    )
    if lead is None:
        raise serializers.ValidationError('Lead was not found.')
    if lead.converted_at is not None or lead.status == Lead.Status.CONVERTED:
        raise serializers.ValidationError({'detail': 'Lead is already converted.'})

    duplicate_candidates = []
    if data.get('existing_contact') is None:
        duplicate_candidates = [
            candidate for candidate in DuplicateDetectionService.check(
                organization=organization,
                target_type='contact',
                data={
                    'first_name': lead.first_name,
                    'last_name': lead.last_name,
                    'email': lead.email,
                    'phone': lead.phone,
                    'country': lead.country,
                    'company_id': lead.company_id,
                    'company_name': lead.company_name,
                    'city': lead.city,
                },
            )
            if not (candidate['candidate_type'] == 'lead' and candidate['candidate_id'] == lead.pk)
        ]
    creating_company = (
        data.get('existing_company') is None
        and data.get('create_company', True)
        and lead.company is None
        and bool(lead.company_name)
    )
    if creating_company:
        duplicate_candidates.extend(DuplicateDetectionService.check(
            organization=organization,
            target_type='company',
            data={'name': lead.company_name, 'country': lead.country, 'city': lead.city},
        ))
    duplicate_candidates.sort(
        key=lambda candidate: (-candidate['confidence_score'], candidate['candidate_type'], candidate['candidate_id'])
    )
    if duplicate_candidates and not data.get('allow_duplicates', False):
        raise DuplicateConflict(duplicate_candidates)

    company = data.get('existing_company')
    if company is None and data.get('create_company', True) and (lead.company or lead.company_name):
        company = lead.company
        if company is None:
            company = Company.objects.create(
                organization=organization,
                created_by=actor,
                updated_by=actor,
                name=lead.company_name,
                currency=lead.currency or organization.currency,
                owner=lead.owner,
                team=lead.team,
                source=lead.source,
                source_record=lead.source_record,
                country=lead.country,
                city=lead.city,
            )
            _copy_custom_fields(lead, company, 'lead', 'company', actor, require_all=True)
            company.tags.add(*lead.tags.all())
            record_event(
                organization=organization, actor=actor, event_type='company.created', instance=company
            )

    elif company is not None:
        company.tags.add(*lead.tags.all())
        _copy_custom_fields(
            lead, company, 'lead', 'company', actor, preserve_existing=True
        )

    contact = data.get('existing_contact')
    if contact is None:
        contact = Contact.objects.create(
            organization=organization,
            created_by=actor,
            updated_by=actor,
            first_name=lead.first_name,
            last_name=lead.last_name,
            display_name=lead.display_name,
            email=lead.email,
            phone=lead.phone,
            secondary_phone=lead.secondary_phone,
            job_title=lead.job_title,
            source=lead.source,
            source_record=lead.source_record,
            owner=lead.owner,
            team=lead.team,
            lifecycle_stage=lead.lifecycle_stage,
            preferred_channel=lead.preferred_channel,
            language=lead.language,
            timezone=lead.timezone,
            country=lead.country,
            city=lead.city,
            address=lead.address,
            description=lead.description,
            company=company,
        )
        contact.tags.add(*lead.tags.all())
        _copy_custom_fields(lead, contact, 'lead', 'contact', actor, require_all=True)
        record_event(
            organization=organization, actor=actor, event_type='contact.created', instance=contact
        )
    else:
        if company and contact.company_id is None:
            contact.company = company
            contact.updated_by = actor
            contact.save(update_fields=['company', 'updated_by', 'updated_at'])
        contact.tags.add(*lead.tags.all())
        _copy_custom_fields(
            lead, contact, 'lead', 'contact', actor, preserve_existing=True
        )

    # Keep the lead link for provenance while making the history visible on the targets.
    Note.objects.filter(organization=organization, lead=lead).update(contact=contact)
    Activity.objects.filter(organization=organization, lead=lead).update(contact=contact)
    if company is not None:
        Note.objects.filter(organization=organization, lead=lead).update(company=company)
        Activity.objects.filter(organization=organization, lead=lead).update(company=company)

    deal = None
    if data.get('create_deal'):
        pipeline = data.get('pipeline')
        if pipeline is None:
            pipeline = (
                Pipeline.objects.filter(organization=organization, is_default=True).first()
                or Pipeline.objects.filter(organization=organization).order_by('id').first()
            )
        if pipeline is None:
            raise serializers.ValidationError('No pipeline is available to create a deal.')
        stage = data.get('stage') or pipeline.stages.filter(
            active=True, archived_at__isnull=True, stage_type__in=(Stage.Type.OPEN, Stage.Type.ON_HOLD)
        ).order_by('order', 'id').first()
        if stage is not None and stage.pipeline_id != pipeline.id:
            raise serializers.ValidationError({'stage': 'Stage does not belong to the selected pipeline.'})
        if stage is None or not stage.active or stage.archived_at or stage.stage_type not in (
            Stage.Type.OPEN, Stage.Type.ON_HOLD
        ):
            raise serializers.ValidationError({'stage': 'Select an active open stage.'})
        deal = Deal.objects.create(
            organization=organization,
            created_by=actor,
            updated_by=actor,
            title=data.get('deal_title') or f'{lead.full_name} deal',
            value=data.get('deal_value') or lead.estimated_value or 0,
            currency=lead.currency or organization.currency,
            pipeline=pipeline,
            stage=stage,
            contact=contact,
            company=company,
            owner=lead.owner,
            team=lead.team,
            source=lead.source,
            source_lead=lead,
        )
        deal.tags.add(*lead.tags.all())
        _copy_custom_fields(lead, deal, 'lead', 'deal', actor, require_all=True)
        create_initial_history(deal, actor)
        add_participant(deal=deal, contact=contact, role='primary', is_primary=True, actor=actor)
        Note.objects.filter(organization=organization, lead=lead).update(deal=deal)
        Activity.objects.filter(organization=organization, lead=lead).update(deal=deal)
        record_event(organization=organization, actor=actor, event_type='deal.created', instance=deal)

    lead.status = Lead.Status.CONVERTED
    lead.converted_at = timezone.now()
    lead.converted_contact = contact
    lead.converted_company = company
    lead.converted_deal = deal
    lead.updated_by = actor
    lead.save(
        update_fields=[
            'status', 'converted_at', 'converted_contact', 'converted_company', 'converted_deal',
            'updated_by', 'updated_at',
        ]
    )
    record_event(
        organization=organization,
        actor=actor,
        event_type='lead.converted',
        instance=lead,
        metadata={
            'contact_id': contact.id,
            'company_id': company.id if company else None,
            'deal_id': deal.id if deal else None,
        },
    )
    return {
        'lead': lead,
        'contact_id': contact.id,
        'company_id': company.id if company else None,
        'deal_id': deal.id if deal else None,
        'duplicate_candidates': duplicate_candidates,
    }

import csv
import io

from django.db import transaction
from django.db.models import Q
from rest_framework import serializers

from apps.contacts.models import Company, Contact
from apps.contacts.serializers import CompanySerializer, ContactSerializer
from apps.leads.models import Lead
from apps.leads.serializers import LeadSerializer
from apps.deals.models import Deal, Pipeline, Stage
from apps.deals.serializers import DealSerializer
from apps.core.normalization import normalize_email, normalize_name
from apps.organizations.models import Membership
from apps.activities.models import Activity
from apps.activities.serializers import ActivitySerializer
from apps.activities.services import initialize_activity

from .duplicates import DuplicateDetectionService
from .events import record_event
from .models import CustomFieldDefinition, CustomFieldValue


MODEL_MAP = {'lead': Lead, 'contact': Contact, 'company': Company, 'deal': Deal, 'activity': Activity}
SERIALIZER_MAP = {
    'lead': LeadSerializer, 'contact': ContactSerializer, 'company': CompanySerializer,
    'deal': DealSerializer, 'activity': ActivitySerializer,
}
CORE_FIELDS = {
    'lead': [
        'id', 'display_name', 'first_name', 'last_name', 'email', 'phone', 'company_name', 'source',
        'status', 'score', 'estimated_value', 'currency', 'owner', 'created_at', 'updated_at',
    ],
    'contact': [
        'id', 'display_name', 'first_name', 'last_name', 'email', 'phone', 'job_title', 'company',
        'owner', 'lifecycle_stage', 'created_at', 'updated_at',
    ],
    'company': [
        'id', 'name', 'legal_name', 'domain', 'industry', 'size', 'phone', 'email', 'owner',
        'lifecycle_stage', 'created_at', 'updated_at',
    ],
    'deal': [
        'id', 'title', 'company', 'contact', 'pipeline', 'stage', 'value', 'currency', 'probability_override',
        'weighted_value', 'status', 'priority', 'owner', 'expected_close_date', 'actual_close_date',
        'lost_reason_record', 'created_at', 'updated_at',
    ],
    'activity': [
        'id', 'type', 'title', 'status', 'priority', 'assigned_to', 'contact', 'company', 'deal', 'lead',
        'due_at', 'due_date', 'starts_at', 'ends_at', 'scheduled_timezone', 'completed_at', 'outcome',
        'source', 'created_at', 'updated_at',
    ],
}
SORT_FIELDS = {
    'lead': {'display_name', 'created_at', 'updated_at', 'score', 'estimated_value', 'company_name', 'owner'},
    'contact': {'display_name', 'first_name', 'last_name', 'created_at', 'updated_at', 'company', 'owner'},
    'company': {'name', 'created_at', 'updated_at', 'annual_revenue', 'owner'},
    'deal': {'title', 'value', 'created_at', 'updated_at', 'expected_close_date', 'owner', 'stage'},
    'activity': {'title', 'priority', 'due_at', 'starts_at', 'created_at', 'updated_at', 'completed_at'},
}
IMPORT_FIELDS = {
    'lead': {
        'display_name', 'first_name', 'last_name', 'email', 'phone', 'secondary_phone', 'company_name',
        'job_title', 'source', 'status', 'estimated_value', 'currency', 'country', 'city', 'address',
        'timezone', 'language', 'preferred_channel', 'description', 'utm_source', 'utm_medium',
        'utm_campaign', 'utm_term', 'utm_content',
    },
    'contact': {
        'display_name', 'first_name', 'last_name', 'email', 'phone', 'secondary_phone', 'job_title',
        'department', 'company_name', 'source', 'lifecycle_stage', 'preferred_channel', 'language',
        'timezone', 'country', 'city', 'address', 'description',
    },
    'company': {
        'name', 'legal_name', 'domain', 'website', 'phone', 'email', 'industry', 'size', 'employee_count',
        'annual_revenue', 'currency', 'country', 'city', 'address', 'lifecycle_stage', 'source', 'description',
    },
    'deal': {
        'title', 'description', 'value', 'currency', 'probability_override', 'priority', 'source', 'deal_type',
        'forecast_category', 'expected_close_date', 'pipeline_name', 'stage_name', 'company_name',
        'contact_email', 'owner_email',
    },
    'activity': {
        'type', 'title', 'description', 'priority', 'due_at', 'due_date', 'all_day', 'starts_at', 'ends_at',
        'scheduled_timezone', 'call_direction', 'phone_number', 'location', 'meeting_url',
        'contact_email', 'company_name', 'deal_title', 'owner_email',
    },
}


def _one_reference(queryset, field):
    matches = list(queryset[:2])
    if len(matches) > 1:
        raise serializers.ValidationError({field: 'Reference is ambiguous; use a unique value.'})
    if not matches:
        raise serializers.ValidationError({field: 'Referenced record was not found.'})
    return matches[0]


def _resolve_deal_references(payload, organization):
    pipeline_name = str(payload.pop('pipeline_name', '')).strip()
    if pipeline_name:
        pipeline = _one_reference(
            Pipeline.objects.filter(organization=organization, active=True, archived_at__isnull=True).filter(
                Q(key=pipeline_name) | Q(name__iexact=pipeline_name)
            ), 'pipeline_name',
        )
    else:
        pipeline = Pipeline.objects.filter(
            organization=organization, is_default=True, active=True, archived_at__isnull=True
        ).first()
        if pipeline is None:
            raise serializers.ValidationError({'pipeline_name': 'Tenant has no default active pipeline.'})
    payload['pipeline'] = pipeline.id
    stage_name = str(payload.pop('stage_name', '')).strip()
    if stage_name:
        stage = _one_reference(
            Stage.objects.filter(
                organization=organization, pipeline=pipeline, active=True, archived_at__isnull=True,
                name__iexact=stage_name,
            ), 'stage_name',
        )
        payload['stage'] = stage.id
    company_name = str(payload.pop('company_name', '')).strip()
    if company_name:
        company = _one_reference(
            Company.objects.filter(
                organization=organization, archived_at__isnull=True, normalized_name=normalize_name(company_name)
            ), 'company_name',
        )
        payload['company'] = company.id
    contact_email = str(payload.pop('contact_email', '')).strip()
    if contact_email:
        contact = _one_reference(
            Contact.objects.filter(
                organization=organization, archived_at__isnull=True,
                normalized_email=normalize_email(contact_email),
            ), 'contact_email',
        )
        payload['contact'] = contact.id
    owner_email = str(payload.pop('owner_email', '')).strip()
    if owner_email:
        membership = _one_reference(
            Membership.objects.filter(
                organization=organization, is_active=True, user__email__iexact=owner_email
            ).select_related('user'), 'owner_email',
        )
        payload['owner'] = membership.user_id
    return payload


def _resolve_activity_references(payload, organization):
    references = (
        ('contact_email', 'contact', Contact, lambda value: Q(normalized_email=normalize_email(value))),
        ('company_name', 'company', Company, lambda value: Q(normalized_name=normalize_name(value))),
        ('deal_title', 'deal', Deal, lambda value: Q(normalized_title=normalize_name(value))),
    )
    for input_field, target_field, model, query_builder in references:
        value = str(payload.pop(input_field, '')).strip()
        if value:
            instance = _one_reference(
                model.objects.filter(organization=organization, archived_at__isnull=True).filter(query_builder(value)),
                input_field,
            )
            payload[target_field] = instance.id
    owner_email = str(payload.pop('owner_email', '')).strip()
    if owner_email:
        member = _one_reference(
            Membership.objects.filter(organization=organization, is_active=True, user__email__iexact=owner_email).select_related('user'),
            'owner_email',
        )
        payload['assigned_to'] = member.user_id
    return payload


def _open_csv(job):
    job.source_file.open('rb')
    return io.TextIOWrapper(job.source_file.file, encoding='utf-8-sig', errors='strict', newline='')


def preview_import(job):
    try:
        stream = _open_csv(job)
        sample = stream.read(65536)
        stream.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=',;\t|')
        except csv.Error:
            dialect = csv.excel
        reader = csv.DictReader(stream, dialect=dialect)
        columns = [str(item).strip() for item in (reader.fieldnames or [])]
        if not columns or any(not item for item in columns):
            raise serializers.ValidationError('CSV must contain a non-empty header row.')
        if len(columns) != len(set(columns)):
            raise serializers.ValidationError('CSV header names must be unique.')
        if len(columns) > 200:
            raise serializers.ValidationError('CSV may not contain more than 200 columns.')
        rows = []
        for row in reader:
            rows.append({key: (value or '')[:500] for key, value in row.items() if key is not None})
            if len(rows) == 10:
                break
        job.detected_columns = columns
        job.preview_rows = rows
        job.status = job.Status.VALIDATED
        job.save(update_fields=['detected_columns', 'preview_rows', 'status', 'updated_at'])
    except (UnicodeDecodeError, csv.Error) as exc:
        job.status = job.Status.FAILED
        job.report = {'error': f'Unable to parse CSV: {exc}'}
        job.save(update_fields=['status', 'report', 'updated_at'])
        raise serializers.ValidationError(job.report['error']) from exc
    finally:
        try:
            stream.detach()
        except Exception:
            pass
        job.source_file.close()
    return job


def _mapped_row(row, mapping):
    payload = {}
    custom = {}
    for column, target in mapping.items():
        value = row.get(column, '')
        if value == '':
            continue
        if target.startswith('custom.'):
            custom[target.removeprefix('custom.')] = value
        else:
            payload[target] = value
    if custom:
        payload['custom_fields'] = custom
    if 'display_name' in payload and 'first_name' not in payload:
        parts = payload['display_name'].strip().split(maxsplit=1)
        payload['first_name'] = parts[0] if parts else ''
        payload.setdefault('last_name', parts[1] if len(parts) > 1 else '')
    return payload


def _safe_error_row(row):
    sensitive = ('password', 'token', 'secret', 'credential', 'access_key', 'api_key')
    return {
        key: '[redacted]' if any(token in key.casefold() for token in sensitive) else str(value)[:200]
        for key, value in row.items()
        if key is not None
    }


def process_import(*, job, mapping, request, duplicate_policy='skip'):
    if job.status not in (job.Status.VALIDATED, job.Status.FAILED):
        raise serializers.ValidationError('Import is not ready for processing.')
    if duplicate_policy not in ('skip', 'create'):
        raise serializers.ValidationError({'duplicate_policy': 'Use skip or create.'})
    unknown_columns = set(mapping) - set(job.detected_columns)
    if unknown_columns:
        raise serializers.ValidationError({'mapping': f'Unknown columns: {", ".join(sorted(unknown_columns))}.'})
    if not mapping:
        raise serializers.ValidationError({'mapping': 'Map at least one column.'})
    mapped_targets = list(mapping.values())
    if any(not isinstance(target, str) or not target for target in mapped_targets):
        raise serializers.ValidationError({'mapping': 'Every mapped target must be a non-empty string.'})
    if len(mapped_targets) != len(set(mapped_targets)):
        raise serializers.ValidationError({'mapping': 'Each target field may be mapped only once.'})
    custom_keys = {target.removeprefix('custom.') for target in mapped_targets if target.startswith('custom.')}
    valid_custom_keys = set(CustomFieldDefinition.objects.filter(
        organization=job.organization, target_object=job.target_object, active=True, key__in=custom_keys
    ).values_list('key', flat=True))
    core_targets = {target for target in mapped_targets if not target.startswith('custom.')}
    if not core_targets.issubset(IMPORT_FIELDS[job.target_object]) or valid_custom_keys != custom_keys:
        raise serializers.ValidationError({'mapping': 'One or more target fields are unknown or inactive.'})
    serializer_class = SERIALIZER_MAP[job.target_object]
    scoring_rules = None
    if job.target_object == 'lead':
        from .scoring import LeadScoringService

        scoring_rules = LeadScoringService.rules_for(job.organization, request.user)
    job.mapping = mapping
    job.status = job.Status.PROCESSING
    job.save(update_fields=['mapping', 'status', 'updated_at'])
    report = {'total': 0, 'successful': 0, 'failed': 0, 'skipped': 0, 'duplicate_candidates': 0, 'errors': []}
    try:
        stream = _open_csv(job)
        sample = stream.read(65536)
        stream.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=',;\t|')
        except csv.Error:
            dialect = csv.excel
        reader = csv.DictReader(stream, dialect=dialect)
        for row_number, row in enumerate(reader, start=2):
            report['total'] += 1
            payload = _mapped_row(row, mapping)
            try:
                if job.target_object == 'deal':
                    payload = _resolve_deal_references(payload, job.organization)
                elif job.target_object == 'activity':
                    payload = _resolve_activity_references(payload, job.organization)
                company_name = ''
                company = None
                if job.target_object == 'contact' and payload.get('company_name'):
                    company_name = str(payload.pop('company_name')).strip()
                    company = Company.objects.filter(
                        organization=job.organization, normalized_name=normalize_name(company_name)
                    ).first()
                    if company is not None:
                        payload['company'] = company.id
                candidates = [] if job.target_object in ('deal', 'activity') else DuplicateDetectionService.check(
                    organization=job.organization, target_type=job.target_object,
                    data={**payload, 'company_name': company_name},
                )
                if candidates:
                    report['duplicate_candidates'] += 1
                    if duplicate_policy == 'skip':
                        report['skipped'] += 1
                        continue
                with transaction.atomic():
                    if company_name and company is None:
                        company = Company.objects.create(
                            organization=job.organization,
                            created_by=request.user,
                            updated_by=request.user,
                            name=company_name,
                            currency=job.organization.currency,
                        )
                        record_event(
                            organization=job.organization,
                            actor=request.user,
                            event_type='company.created',
                            instance=company,
                            metadata={'import_id': job.id, 'row_number': row_number},
                        )
                        payload['company'] = company.id
                    serializer = serializer_class(data=payload, context={'request': request})
                    serializer.is_valid(raise_exception=True)
                    instance = serializer.save(
                        organization=job.organization, created_by=request.user, updated_by=request.user
                    )
                    if job.target_object == 'lead':
                        scoring = LeadScoringService.calculate(instance, scoring_rules)
                        instance.score = scoring['score']
                        instance.score_breakdown = scoring['reasons']
                        instance.save(update_fields=['score', 'score_breakdown', 'updated_at'])
                    if job.target_object == 'activity':
                        instance.source = Activity.Source.IMPORT
                        instance.source_id = str(job.id)
                        instance.save(update_fields=['source', 'source_id', 'updated_at'])
                        initialize_activity(instance, request.user)
                    else:
                        record_event(
                            organization=job.organization,
                            actor=request.user,
                            event_type=f'{job.target_object}.created',
                            instance=instance,
                            metadata={'import_id': job.id, 'row_number': row_number},
                        )
                report['successful'] += 1
            except Exception as exc:
                report['failed'] += 1
                if len(report['errors']) < 1000:
                    detail = getattr(exc, 'detail', str(exc))
                    report['errors'].append(
                        {
                            'row_number': row_number,
                            'field': next(iter(detail), None) if isinstance(detail, dict) else None,
                            'reason': detail,
                            'raw_value': _safe_error_row(row),
                        }
                    )
        job.status = job.Status.COMPLETED
    except (UnicodeDecodeError, csv.Error) as exc:
        job.status = job.Status.FAILED
        report['error'] = f'CSV parsing failed: {exc}'
    finally:
        try:
            stream.detach()
        except Exception:
            pass
        job.source_file.close()
        job.report = report
        job.save(update_fields=['status', 'report', 'updated_at'])
    return job


def _safe_csv(value):
    if value is None:
        return ''
    if hasattr(value, 'isoformat'):
        value = value.isoformat()
    value = str(value)
    if value.startswith(('=', '+', '-', '@', '\t', '\r')):
        return "'" + value
    return value


def export_queryset(*, organization, target_object, filters, fields, sort):
    model = MODEL_MAP[target_object]
    allowed_fields = CORE_FIELDS[target_object]
    selected = fields or allowed_fields
    if not isinstance(selected, list) or not selected or len(selected) > 200 or not all(
        isinstance(field, str) and field for field in selected
    ):
        raise serializers.ValidationError({'fields': 'Provide 1 to 200 valid export field names.'})
    custom_keys = {field.removeprefix('custom.') for field in selected if isinstance(field, str) and field.startswith('custom.')}
    valid_custom_keys = set(CustomFieldDefinition.objects.filter(
        organization=organization, target_object=target_object, active=True, key__in=custom_keys
    ).values_list('key', flat=True))
    selected_core = {field for field in selected if not str(field).startswith('custom.')}
    if not selected_core.issubset(allowed_fields) or valid_custom_keys != custom_keys:
        raise serializers.ValidationError({'fields': 'One or more export fields are not allowed.'})
    sort_value = sort or '-created_at'
    sort_field = sort_value.lstrip('-')
    if sort_field not in SORT_FIELDS[target_object]:
        raise serializers.ValidationError({'sort': 'Unsupported sort field.'})
    queryset = model.objects.filter(organization=organization)
    archived = filters.get('archived', 'false')
    if archived == 'only':
        queryset = queryset.filter(archived_at__isnull=False)
    elif archived != 'all':
        queryset = queryset.filter(archived_at__isnull=True)
    filter_map = {
        'lead': {
            'status': 'status', 'source': 'source', 'owner': 'owner_id', 'team': 'team_id',
            'lifecycle_stage': 'lifecycle_stage', 'company': 'company_id', 'country': 'country', 'city': 'city',
            'score_min': 'score__gte', 'score_max': 'score__lte',
            'estimated_value_min': 'estimated_value__gte', 'estimated_value_max': 'estimated_value__lte',
            'created_from': 'created_at__gte', 'created_to': 'created_at__lte',
        },
        'contact': {
            'company': 'company_id', 'owner': 'owner_id', 'team': 'team_id', 'source': 'source',
            'lifecycle_stage': 'lifecycle_stage', 'is_active': 'is_active', 'country': 'country', 'city': 'city',
            'created_from': 'created_at__gte', 'created_to': 'created_at__lte',
        },
        'company': {
            'industry': 'industry', 'size': 'size', 'owner': 'owner_id', 'team': 'team_id',
            'country': 'country', 'city': 'city', 'lifecycle_stage': 'lifecycle_stage', 'source': 'source',
            'revenue_min': 'annual_revenue__gte', 'revenue_max': 'annual_revenue__lte',
            'created_from': 'created_at__gte', 'created_to': 'created_at__lte',
        },
        'deal': {
            'pipeline': 'pipeline_id', 'stage': 'stage_id', 'status': 'status', 'priority': 'priority',
            'owner': 'owner_id', 'team': 'team_id', 'company': 'company_id', 'contact': 'contact_id',
            'source': 'source', 'amount_min': 'value__gte', 'amount_max': 'value__lte',
            'expected_close_from': 'expected_close_date__gte', 'expected_close_to': 'expected_close_date__lte',
            'created_from': 'created_at__gte', 'created_to': 'created_at__lte',
        },
        'activity': {
            'type': 'type', 'status': 'status', 'priority': 'priority', 'assigned_to': 'assigned_to_id',
            'team': 'team_id', 'contact': 'contact_id', 'company': 'company_id', 'deal': 'deal_id',
            'lead': 'lead_id', 'source': 'source', 'due_after': 'due_at__gte', 'due_before': 'due_at__lte',
            'created_after': 'created_at__gte', 'completed_after': 'completed_at__gte',
            'completed_before': 'completed_at__lte',
        },
    }[target_object]
    for key, value in filters.items():
        if key in ('archived', 'search') or value in ('', None):
            continue
        if key not in filter_map:
            raise serializers.ValidationError({'filters': f'Unsupported filter: {key}.'})
        queryset = queryset.filter(**{filter_map[key]: value})
    search = filters.get('search')
    if search:
        if target_object == 'company':
            queryset = queryset.filter(Q(name__icontains=search) | Q(domain__icontains=search) | Q(email__icontains=search))
        elif target_object in ('lead', 'contact'):
            queryset = queryset.filter(
                Q(first_name__icontains=search) | Q(last_name__icontains=search) |
                Q(email__icontains=search) | Q(phone__icontains=search)
            )
        elif target_object == 'deal':
            queryset = queryset.filter(
                Q(title__icontains=search) | Q(company__name__icontains=search) |
                Q(contact__display_name__icontains=search)
            )
        else:
            queryset = queryset.filter(
                Q(title__icontains=search) | Q(description__icontains=search) |
                Q(contact__display_name__icontains=search) | Q(company__name__icontains=search) |
                Q(deal__title__icontains=search)
            )
    if target_object == 'deal':
        queryset = queryset.select_related(
            'company', 'contact', 'pipeline', 'stage', 'owner', 'lost_reason_record'
        )
    elif target_object == 'activity':
        queryset = queryset.select_related('assigned_to', 'contact', 'company', 'deal', 'lead')
    return queryset.order_by(sort_value, 'id'), selected


def _custom_export_value(value):
    if value is None:
        return ''
    for field in ('text_value', 'number_value', 'boolean_value', 'date_value', 'datetime_value', 'json_value'):
        resolved = getattr(value, field)
        if resolved is not None:
            return ', '.join(map(str, resolved)) if isinstance(resolved, list) else resolved
    return ''


def csv_stream(queryset, fields, organization, target_object):
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator='\r\n')
    writer.writerow(fields)
    yield '\ufeff' + buffer.getvalue()
    buffer.seek(0)
    buffer.truncate(0)
    custom_keys = [field.removeprefix('custom.') for field in fields if field.startswith('custom.')]
    batch = []
    for instance in queryset.iterator(chunk_size=1000):
        batch.append(instance)
        if len(batch) < 1000:
            continue
        yield from _csv_batch(batch, fields, custom_keys, organization, target_object, writer, buffer)
        batch = []
    if batch:
        yield from _csv_batch(batch, fields, custom_keys, organization, target_object, writer, buffer)


def _csv_batch(batch, fields, custom_keys, organization, target_object, writer, buffer):
    custom = {}
    if custom_keys:
        values = CustomFieldValue.objects.filter(
            organization=organization,
            target_object=target_object,
            object_id__in=[instance.pk for instance in batch],
            definition__key__in=custom_keys,
        ).select_related('definition')
        custom = {(value.object_id, value.definition.key): _custom_export_value(value) for value in values}
    for instance in batch:
        row = []
        for field in fields:
            if field.startswith('custom.'):
                value = custom.get((instance.pk, field.removeprefix('custom.')), '')
            else:
                if target_object == 'deal' and field in ('company', 'contact', 'pipeline', 'stage', 'owner', 'lost_reason_record'):
                    related = getattr(instance, field)
                    value = '' if related is None else getattr(
                        related, 'name', getattr(related, 'display_name', getattr(related, 'email', str(related)))
                    )
                elif target_object == 'deal' and field == 'weighted_value':
                    value = instance.weighted_value
                elif target_object == 'activity' and field in (
                    'assigned_to', 'contact', 'company', 'deal', 'lead'
                ):
                    related = getattr(instance, field)
                    value = '' if related is None else getattr(
                        related, 'name', getattr(
                            related, 'display_name', getattr(
                                related, 'title', getattr(related, 'email', str(related))
                            )
                        )
                    )
                else:
                    value = getattr(instance, f'{field}_id') if field in ('owner', 'company') else getattr(instance, field)
            row.append(_safe_csv(value))
        writer.writerow(row)
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)

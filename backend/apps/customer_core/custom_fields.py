from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import URLValidator
from django.db import IntegrityError, transaction
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import serializers

from apps.core.normalization import normalize_email, normalize_name, normalize_phone

from .models import CustomFieldDefinition, CustomFieldValue


def _options(definition):
    return {
        str(option.get('value') if isinstance(option, dict) else option)
        for option in (definition.options or [])
    }


def validate_custom_value(definition, value):
    data_type = definition.data_type
    if value in (None, ''):
        if definition.required:
            raise serializers.ValidationError('This custom field is required.')
        return None
    try:
        if data_type in ('text', 'textarea'):
            parsed = str(value)
            max_length = definition.validation_rules.get('max_length')
            if max_length and len(parsed) > int(max_length):
                raise serializers.ValidationError(f'Must be at most {max_length} characters.')
            return parsed
        if data_type == 'integer':
            if isinstance(value, bool) or str(value).strip().lstrip('-').isdigit() is False:
                raise serializers.ValidationError('Enter a whole number.')
            parsed = int(value)
            if definition.validation_rules.get('min') is not None and parsed < int(definition.validation_rules['min']):
                raise serializers.ValidationError(f'Must be at least {definition.validation_rules["min"]}.')
            if definition.validation_rules.get('max') is not None and parsed > int(definition.validation_rules['max']):
                raise serializers.ValidationError(f'Must be at most {definition.validation_rules["max"]}.')
            return parsed
        if data_type in ('decimal', 'currency'):
            parsed = Decimal(str(value))
            if not parsed.is_finite():
                raise serializers.ValidationError('Enter a finite decimal number.')
            precision = definition.validation_rules.get('precision')
            decimal_places = max(0, -parsed.as_tuple().exponent)
            if precision is not None and decimal_places > int(precision):
                raise serializers.ValidationError(f'Use at most {precision} decimal places.')
            if definition.validation_rules.get('min') is not None and parsed < Decimal(str(definition.validation_rules['min'])):
                raise serializers.ValidationError(f'Must be at least {definition.validation_rules["min"]}.')
            if definition.validation_rules.get('max') is not None and parsed > Decimal(str(definition.validation_rules['max'])):
                raise serializers.ValidationError(f'Must be at most {definition.validation_rules["max"]}.')
            return parsed
        if data_type == 'boolean':
            if not isinstance(value, bool):
                raise serializers.ValidationError('Enter true or false.')
            return value
        if data_type == 'date':
            parsed = value if isinstance(value, date) and not isinstance(value, datetime) else parse_date(str(value))
            if parsed is None:
                raise serializers.ValidationError('Enter a valid date in YYYY-MM-DD format.')
            return parsed
        if data_type == 'datetime':
            parsed = value if isinstance(value, datetime) else parse_datetime(str(value))
            if parsed is None:
                raise serializers.ValidationError('Enter a valid ISO 8601 datetime.')
            return parsed
        if data_type == 'email':
            return normalize_email(str(value))
        if data_type == 'phone':
            return normalize_phone(str(value), definition.validation_rules.get('country'))
        if data_type == 'url':
            parsed = str(value).strip()
            URLValidator(schemes=('http', 'https'))(parsed)
            return parsed
        if data_type == 'select':
            parsed = str(value)
            if parsed not in _options(definition):
                raise serializers.ValidationError('Select a configured option.')
            return parsed
        if data_type == 'multi_select':
            if not isinstance(value, list):
                raise serializers.ValidationError('Enter a list of configured options.')
            parsed = [str(item) for item in value]
            unknown = set(parsed) - _options(definition)
            if unknown:
                raise serializers.ValidationError(f'Unknown options: {", ".join(sorted(unknown))}.')
            return list(dict.fromkeys(parsed))
    except (InvalidOperation, ValueError, TypeError, DjangoValidationError) as exc:
        raise serializers.ValidationError(str(exc)) from exc
    raise serializers.ValidationError(f'Unsupported custom field type: {data_type}.')


def validate_custom_fields(*, organization, target_object, payload, require_all=True, definitions=None):
    if not isinstance(payload, dict):
        raise serializers.ValidationError('Custom fields must be an object keyed by field key.')
    if definitions is None:
        definitions = {
            definition.key: definition
            for definition in CustomFieldDefinition.objects.filter(
                organization=organization, target_object=target_object, active=True
            )
        }
    unknown = set(payload) - set(definitions)
    if unknown:
        raise serializers.ValidationError({key: 'Unknown or inactive custom field.' for key in sorted(unknown)})
    errors = {}
    parsed = {}
    for key, definition in definitions.items():
        if key not in payload:
            if require_all and definition.required and definition.default_value is None:
                errors[key] = 'This custom field is required.'
            elif require_all and definition.default_value is not None:
                parsed[key] = validate_custom_value(definition, definition.default_value)
            continue
        try:
            parsed[key] = validate_custom_value(definition, payload[key])
        except serializers.ValidationError as exc:
            errors[key] = exc.detail
    if errors:
        raise serializers.ValidationError(errors)
    return parsed, definitions


def _columns(definition, value):
    columns = {
        'text_value': None,
        'number_value': None,
        'boolean_value': None,
        'date_value': None,
        'datetime_value': None,
        'json_value': None,
        'normalized_value': '',
    }
    if value is None:
        return columns
    data_type = definition.data_type
    if data_type in ('integer', 'decimal', 'currency'):
        columns['number_value'] = value
        columns['normalized_value'] = str(value)
    elif data_type == 'boolean':
        columns['boolean_value'] = value
        columns['normalized_value'] = 'true' if value else 'false'
    elif data_type == 'date':
        columns['date_value'] = value
        columns['normalized_value'] = value.isoformat()
    elif data_type == 'datetime':
        columns['datetime_value'] = value
        columns['normalized_value'] = value.isoformat()
    elif data_type == 'multi_select':
        columns['json_value'] = value
        columns['normalized_value'] = f'|{"|".join(sorted(normalize_name(item) for item in value))}|'
    else:
        columns['text_value'] = value
        columns['normalized_value'] = normalize_name(str(value))
    return columns


def custom_filter_expression(definition, lookup, raw_value):
    """Return a validated typed value lookup for a custom-field query."""
    data_type = definition.data_type
    allowed = {
        'text': {'exact', 'contains'},
        'textarea': {'exact', 'contains'},
        'integer': {'exact', 'gte', 'lte'},
        'decimal': {'exact', 'gte', 'lte'},
        'currency': {'exact', 'gte', 'lte'},
        'boolean': {'exact'},
        'date': {'exact', 'gte', 'lte'},
        'datetime': {'exact', 'gte', 'lte'},
        'email': {'exact', 'contains'},
        'phone': {'exact', 'contains'},
        'url': {'exact', 'contains'},
        'select': {'exact'},
        'multi_select': {'exact', 'contains'},
    }[data_type]
    if lookup not in allowed:
        raise serializers.ValidationError(f'{lookup} is not supported for {data_type} fields.')

    if data_type == 'boolean':
        boolean_values = {'true': True, '1': True, 'yes': True, 'false': False, '0': False, 'no': False}
        parsed = boolean_values.get(str(raw_value).casefold())
        if parsed is None:
            raise serializers.ValidationError('Enter true or false.')
    elif data_type == 'multi_select':
        parsed_values = validate_custom_value(definition, [raw_value])
        normalized = _columns(definition, parsed_values)['normalized_value']
        return 'normalized_value__contains', normalized
    else:
        parsed = validate_custom_value(definition, raw_value)

    columns = _columns(definition, parsed)
    if data_type in ('integer', 'decimal', 'currency'):
        return f'number_value__{lookup}', columns['number_value']
    if data_type == 'boolean':
        return 'boolean_value', columns['boolean_value']
    if data_type == 'date':
        return f'date_value__{lookup}', columns['date_value']
    if data_type == 'datetime':
        return f'datetime_value__{lookup}', columns['datetime_value']
    db_lookup = 'icontains' if lookup == 'contains' else 'exact'
    return f'normalized_value__{db_lookup}', columns['normalized_value']


@transaction.atomic
def set_custom_fields(*, instance, target_object, values, definitions, actor):
    for key, value in values.items():
        definition = definitions[key]
        columns = _columns(definition, value)
        columns['unique_value'] = columns['normalized_value'] if definition.unique and value is not None else None
        if definition.unique and value is not None:
            duplicate = CustomFieldValue.objects.filter(
                organization=instance.organization,
                definition=definition,
                normalized_value=columns['normalized_value'],
            ).exclude(object_id=instance.pk).exists()
            if duplicate:
                raise serializers.ValidationError({key: 'This value must be unique.'})
        if value is None:
            CustomFieldValue.objects.filter(definition=definition, object_id=instance.pk).delete()
            continue
        try:
            CustomFieldValue.objects.update_or_create(
                organization=instance.organization,
                definition=definition,
                object_id=instance.pk,
                defaults={
                    'target_object': target_object,
                    'created_by': actor,
                    'updated_by': actor,
                    **columns,
                },
            )
        except IntegrityError as exc:
            raise serializers.ValidationError({key: 'This value must be unique.'}) from exc


def _resolved_custom_value(value):
    data_type = value.definition.data_type
    if data_type in ('integer', 'decimal', 'currency'):
        resolved = value.number_value
        if data_type == 'integer' and resolved is not None:
            return int(resolved)
        return str(resolved.normalize()) if resolved is not None else None
    if data_type == 'boolean':
        return value.boolean_value
    if data_type == 'date':
        return value.date_value.isoformat() if value.date_value else None
    if data_type == 'datetime':
        return value.datetime_value.isoformat() if value.datetime_value else None
    if data_type == 'multi_select':
        return value.json_value
    return value.text_value


def prime_custom_fields(instances, target_object):
    instances = list(instances)
    cache = {instance.pk: {} for instance in instances}
    if not instances:
        return instances
    values = CustomFieldValue.objects.filter(
        organization_id=instances[0].organization_id, target_object=target_object, object_id__in=cache
    ).select_related('definition')
    for value in values:
        cache[value.object_id][value.definition.key] = _resolved_custom_value(value)
    for instance in instances:
        instance._custom_fields_cache = cache[instance.pk]
    return instances


def custom_fields_for(instance, target_object):
    if hasattr(instance, '_custom_fields_cache'):
        return instance._custom_fields_cache
    result = {}
    values = CustomFieldValue.objects.filter(
        organization=instance.organization, target_object=target_object, object_id=instance.pk
    ).select_related('definition')
    for value in values:
        result[value.definition.key] = _resolved_custom_value(value)
    return result

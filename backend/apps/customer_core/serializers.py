from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Count
from rest_framework import serializers

from apps.core.normalization import normalize_email, normalize_phone
from apps.core.serializers import UserBriefSerializer
from apps.core.utils import get_membership

from .custom_fields import custom_fields_for, set_custom_fields, validate_custom_fields
from .custom_fields import validate_custom_value
from .models import (
    AuditLog,
    CustomFieldDefinition,
    DomainEvent,
    ImportJob,
    LeadSource,
    ObjectTypeDefinition,
    Team,
)


class TeamBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Team
        fields = ['id', 'name']


class LeadSourceSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeadSource
        fields = ['id', 'key', 'system_key', 'label', 'active', 'display_order', 'created_at', 'updated_at']
        read_only_fields = ['id', 'system_key', 'created_at', 'updated_at']


class TeamSerializer(serializers.ModelSerializer):
    class Meta:
        model = Team
        fields = ['id', 'name', 'active', 'members', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_members(self, users):
        organization = get_membership(self.context['request']).organization
        valid_ids = set(
            organization.memberships.filter(is_active=True, user__in=users).values_list('user_id', flat=True)
        )
        if valid_ids != {user.id for user in users}:
            raise serializers.ValidationError('Every team member must belong to this organization.')
        return users


class CustomFieldDefinitionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomFieldDefinition
        fields = [
            'id', 'target_object', 'key', 'label', 'description', 'data_type', 'required', 'unique',
            'default_value', 'options', 'validation_rules', 'display_order', 'active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate(self, attrs):
        target_object = attrs.get('target_object', getattr(self.instance, 'target_object', None))
        organization = get_membership(self.context['request']).organization
        if not ObjectTypeDefinition.objects.filter(
            organization=organization, key=target_object, active=True
        ).exists():
            raise serializers.ValidationError({'target_object': 'Unknown or inactive object type.'})
        data_type = attrs.get('data_type', getattr(self.instance, 'data_type', None))
        options = attrs.get('options', getattr(self.instance, 'options', [])) or []
        if data_type in ('select', 'multi_select'):
            if not options:
                raise serializers.ValidationError({'options': 'Select fields require at least one option.'})
            values = [str(item.get('value', '') if isinstance(item, dict) else item).strip() for item in options]
            if any(not value for value in values):
                raise serializers.ValidationError({'options': 'Option values may not be blank.'})
            if len(values) != len(set(values)):
                raise serializers.ValidationError({'options': 'Option values must be unique.'})
        elif options:
            raise serializers.ValidationError({'options': 'Options are only valid for select fields.'})
        rules = attrs.get('validation_rules', getattr(self.instance, 'validation_rules', {})) or {}
        if not isinstance(rules, dict):
            raise serializers.ValidationError({'validation_rules': 'Validation rules must be an object.'})
        allowed_rules = {'max_length', 'min', 'max', 'country', 'precision'}
        unknown_rules = set(rules) - allowed_rules
        if unknown_rules:
            raise serializers.ValidationError(
                {'validation_rules': f'Unsupported rules: {", ".join(sorted(unknown_rules))}.'}
            )
        rule_errors = {}
        if 'max_length' in rules:
            if data_type not in ('text', 'textarea'):
                rule_errors['max_length'] = 'Only text fields support max_length.'
            else:
                try:
                    if int(rules['max_length']) < 1:
                        raise ValueError
                except (TypeError, ValueError):
                    rule_errors['max_length'] = 'Enter a positive whole number.'
        for bound in ('min', 'max'):
            if bound not in rules:
                continue
            if data_type not in ('integer', 'decimal', 'currency'):
                rule_errors[bound] = 'Only numeric fields support min/max.'
                continue
            try:
                Decimal(str(rules[bound]))
            except (InvalidOperation, TypeError, ValueError):
                rule_errors[bound] = 'Enter a valid number.'
        if 'min' in rules and 'max' in rules and not ({'min', 'max'} & set(rule_errors)):
            if Decimal(str(rules['min'])) > Decimal(str(rules['max'])):
                rule_errors['max'] = 'Must be greater than or equal to min.'
        if 'country' in rules:
            country = str(rules['country']).strip()
            if data_type != 'phone' or len(country) != 2 or not country.isalpha():
                rule_errors['country'] = 'Use a two-letter country code on phone fields.'
        if 'precision' in rules:
            if data_type not in ('decimal', 'currency'):
                rule_errors['precision'] = 'Only decimal and currency fields support precision.'
            else:
                try:
                    precision = int(rules['precision'])
                    if precision < 0 or precision > 6:
                        raise ValueError
                except (TypeError, ValueError):
                    rule_errors['precision'] = 'Enter a whole number from 0 to 6.'
        if rule_errors:
            raise serializers.ValidationError({'validation_rules': rule_errors})
        if self.instance and any(
            key in attrs and attrs[key] != getattr(self.instance, key)
            for key in ('target_object', 'key', 'data_type')
        ):
            raise serializers.ValidationError('Object, key, and data type are immutable after field creation.')
        unique = attrs.get('unique', getattr(self.instance, 'unique', False))
        if self.instance and unique and not self.instance.unique:
            duplicate = (
                self.instance.values.exclude(normalized_value='')
                .values('normalized_value').annotate(count=Count('id')).filter(count__gt=1).exists()
            )
            if duplicate:
                raise serializers.ValidationError({'unique': 'Existing values are not unique.'})
        if 'default_value' in attrs and attrs['default_value'] is not None:
            candidate = self.instance or CustomFieldDefinition(organization=organization)
            for key, value in attrs.items():
                setattr(candidate, key, value)
            try:
                validate_custom_value(candidate, attrs['default_value'])
            except serializers.ValidationError as exc:
                raise serializers.ValidationError({'default_value': exc.detail}) from exc
        return attrs


class DomainEventSerializer(serializers.ModelSerializer):
    actor_detail = UserBriefSerializer(source='actor', read_only=True)

    class Meta:
        model = DomainEvent
        fields = [
            'id', 'actor', 'actor_detail', 'object_type', 'object_id', 'event_type',
            'metadata', 'field_diff', 'created_at',
        ]
        read_only_fields = fields


class AuditLogSerializer(serializers.ModelSerializer):
    actor_detail = UserBriefSerializer(source='actor', read_only=True)

    class Meta:
        model = AuditLog
        fields = ['id', 'actor', 'actor_detail', 'action', 'entity_type', 'entity_id', 'diff', 'created_at']
        read_only_fields = fields


class ImportJobSerializer(serializers.ModelSerializer):
    source_file = serializers.FileField(write_only=True)

    class Meta:
        model = ImportJob
        fields = [
            'id', 'target_object', 'source_file', 'original_filename', 'status', 'detected_columns',
            'preview_rows', 'mapping', 'report', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'original_filename', 'status', 'detected_columns', 'preview_rows', 'mapping', 'report',
            'created_at', 'updated_at',
        ]

    def validate_source_file(self, file):
        if file.size > 50 * 1024 * 1024:
            raise serializers.ValidationError('CSV files may not exceed 50 MB.')
        if not file.name.casefold().endswith('.csv'):
            raise serializers.ValidationError('Upload a CSV file.')
        return file


class CustomerSerializerMixin:
    custom_fields = serializers.JSONField(required=False)
    custom_target = None

    def validate(self, attrs):
        attrs = super().validate(attrs)
        request = self.context['request']
        membership = get_membership(request)
        cache = getattr(request, '_customer_field_definition_cache', None)
        if cache is None:
            cache = {}
            request._customer_field_definition_cache = cache
        cache_key = (membership.organization_id, self.custom_target)
        if cache_key not in cache:
            cache[cache_key] = {
                definition.key: definition
                for definition in CustomFieldDefinition.objects.filter(
                    organization=membership.organization, target_object=self.custom_target, active=True
                )
            }
        definitions = cache[cache_key]
        model_fields = {field.name for field in self.Meta.model._meta.get_fields()}
        if 'source_record' in model_fields and 'source_record' in attrs and attrs['source_record'] is not None:
            attrs['source'] = attrs['source_record'].key
        elif 'source_record' in model_fields and 'source' in attrs and attrs['source']:
            source = LeadSource.objects.filter(
                organization=membership.organization, key=attrs['source'], active=True
            ).first()
            if source is None:
                raise serializers.ValidationError({'source': 'Unknown or inactive lead source.'})
            attrs['source_record'] = source
        country = attrs.get('country', getattr(self.instance, 'country', ''))
        if 'email' in attrs:
            try:
                normalize_email(attrs['email'])
            except Exception as exc:
                raise serializers.ValidationError({'email': str(exc)}) from exc
        phone_key = 'primary_phone' if 'primary_phone' in attrs else 'phone'
        if phone_key in attrs:
            try:
                normalize_phone(attrs[phone_key], country)
            except Exception as exc:
                raise serializers.ValidationError({phone_key: str(exc)}) from exc
        if 'custom_fields' in attrs:
            raw = attrs.pop('custom_fields')
            parsed, definitions = validate_custom_fields(
                organization=membership.organization,
                target_object=self.custom_target,
                payload=raw,
                require_all=self.instance is None,
                definitions=definitions,
            )
            self._custom_values = parsed
            self._custom_definitions = definitions
        elif self.instance is None:
            parsed, definitions = validate_custom_fields(
                organization=membership.organization,
                target_object=self.custom_target,
                payload={},
                require_all=True,
                definitions=definitions,
            )
            self._custom_values = parsed
            self._custom_definitions = definitions
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        instance = super().create(validated_data)
        if hasattr(self, '_custom_values'):
            set_custom_fields(
                instance=instance,
                target_object=self.custom_target,
                values=self._custom_values,
                definitions=self._custom_definitions,
                actor=self.context['request'].user,
            )
        return instance

    @transaction.atomic
    def update(self, instance, validated_data):
        instance = super().update(instance, validated_data)
        if hasattr(self, '_custom_values'):
            set_custom_fields(
                instance=instance,
                target_object=self.custom_target,
                values=self._custom_values,
                definitions=self._custom_definitions,
                actor=self.context['request'].user,
            )
        return instance

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['custom_fields'] = custom_fields_for(instance, self.custom_target)
        return data

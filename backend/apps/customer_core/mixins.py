from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.contacts.models import Tag
from apps.organizations.models import Membership

from .duplicates import DuplicateDetectionService
from .custom_fields import custom_fields_for, custom_filter_expression, prime_custom_fields
from .events import record_event
from .models import CustomFieldDefinition, CustomFieldValue, DomainEvent, Team
from .serializers import DomainEventSerializer


class CustomerRecordViewSetMixin:
    custom_target = None
    bulk_limit = 500
    event_prefix = None

    def paginate_queryset(self, queryset):
        page = super().paginate_queryset(queryset)
        if page is not None:
            prime_custom_fields(page, self.custom_target)
        return page

    def get_queryset(self):
        queryset = super().get_queryset()
        if getattr(self, 'action', None) in ('retrieve', 'timeline'):
            return self._custom_field_filters(queryset)
        archived = self.request.query_params.get('archived', 'false').casefold()
        if archived in ('only', 'true'):
            queryset = queryset.filter(archived_at__isnull=False)
        elif archived not in ('all',):
            queryset = queryset.filter(archived_at__isnull=True)
        return self._custom_field_filters(queryset)

    def _custom_field_filters(self, queryset):
        for key, raw_value in self.request.query_params.items():
            if not key.startswith('custom__'):
                continue
            parts = key.split('__')
            field_key = parts[1] if len(parts) > 1 else ''
            lookup = parts[2] if len(parts) > 2 else 'exact'
            definition = CustomFieldDefinition.objects.filter(
                organization=self.org, target_object=self.custom_target, key=field_key, active=True
            ).first()
            if definition is None:
                raise serializers.ValidationError({key: 'Unknown custom field.'})
            values = CustomFieldValue.objects.filter(organization=self.org, definition=definition)
            try:
                field_lookup, parsed_value = custom_filter_expression(definition, lookup, raw_value)
            except serializers.ValidationError as exc:
                raise serializers.ValidationError({key: exc.detail}) from exc
            values = values.filter(**{field_lookup: parsed_value})
            queryset = queryset.filter(pk__in=values.values('object_id'))
        return queryset

    def _snapshot(self, instance):
        fields = (
            'first_name', 'last_name', 'display_name', 'name', 'email', 'phone', 'domain', 'company_name',
            'job_title', 'industry', 'size', 'annual_revenue', 'estimated_value', 'source', 'status',
            'lifecycle_stage', 'country', 'city', 'owner_id', 'team_id', 'company_id', 'archived_at',
            'title', 'value', 'priority', 'expected_close_date', 'probability_override', 'forecast_category',
        )
        result = {}
        for field in fields:
            if not hasattr(instance, field):
                continue
            value = getattr(instance, field)
            if value is not None and not isinstance(value, (str, int, float, bool)):
                value = value.isoformat() if hasattr(value, 'isoformat') else str(value)
            result[field] = value
        return result

    @transaction.atomic
    def perform_create(self, serializer):
        super().perform_create(serializer)
        instance = serializer.instance
        record_event(
            organization=self.org,
            actor=self.request.user,
            event_type=f'{self.event_prefix}.created',
            instance=instance,
        )
        for tag in instance.tags.all():
            record_event(
                organization=self.org,
                actor=self.request.user,
                event_type='tag.attached',
                instance=instance,
                metadata={'tag_id': tag.id, 'tag_name': tag.name},
                audit=False,
            )

    @transaction.atomic
    def perform_update(self, serializer):
        before = self._snapshot(serializer.instance)
        before_custom = custom_fields_for(serializer.instance, self.custom_target)
        before_tags = {tag.id: tag.name for tag in serializer.instance.tags.all()}
        super().perform_update(serializer)
        instance = serializer.instance
        after = self._snapshot(instance)
        after_custom = custom_fields_for(instance, self.custom_target)
        after_tags = {tag.id: tag.name for tag in instance.tags.all()}
        diff = {
            key: {'from': before.get(key), 'to': after.get(key)}
            for key in after
            if before.get(key) != after.get(key)
        }
        custom_changes = {
            key: {'from': before_custom.get(key), 'to': after_custom.get(key)}
            for key in set(before_custom) | set(after_custom)
            if before_custom.get(key) != after_custom.get(key)
        }
        if custom_changes:
            diff['custom_fields'] = custom_changes
        if before_tags != after_tags:
            diff['tag_ids'] = {'from': sorted(before_tags), 'to': sorted(after_tags)}
        if diff:
            record_event(
                organization=self.org,
                actor=self.request.user,
                event_type=f'{self.event_prefix}.updated',
                instance=instance,
                field_diff=diff,
            )
        for tag_id in sorted(set(after_tags) - set(before_tags)):
            record_event(
                organization=self.org,
                actor=self.request.user,
                event_type='tag.attached',
                instance=instance,
                metadata={'tag_id': tag_id, 'tag_name': after_tags[tag_id]},
                audit=False,
            )
        for tag_id in sorted(set(before_tags) - set(after_tags)):
            record_event(
                organization=self.org,
                actor=self.request.user,
                event_type='tag.detached',
                instance=instance,
                metadata={'tag_id': tag_id, 'tag_name': before_tags[tag_id]},
                audit=False,
            )
        if before.get('owner_id') != after.get('owner_id'):
            record_event(
                organization=self.org,
                actor=self.request.user,
                event_type='owner.changed',
                instance=instance,
                field_diff={'owner_id': {'from': before.get('owner_id'), 'to': after.get('owner_id')}},
            )
        if before.get('status') != after.get('status') and 'status' in after:
            record_event(
                organization=self.org,
                actor=self.request.user,
                event_type=f'{self.event_prefix}.status_changed',
                instance=instance,
                field_diff={'status': {'from': before.get('status'), 'to': after.get('status')}},
                audit=False,
            )
        if before.get('company_id') != after.get('company_id') and 'company_id' in after:
            record_event(
                organization=self.org,
                actor=self.request.user,
                event_type=f'{self.event_prefix}.company_changed',
                instance=instance,
                field_diff={'company_id': {'from': before.get('company_id'), 'to': after.get('company_id')}},
                audit=False,
            )

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.archived_at is None:
            instance.archived_at = timezone.now()
            instance.updated_by = request.user
            instance.save(update_fields=['archived_at', 'updated_by', 'updated_at'])
            record_event(
                organization=self.org, actor=request.user, event_type=f'{self.event_prefix}.archived', instance=instance
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def archive(self, request, pk=None):
        instance = self.get_object()
        if instance.archived_at is None:
            instance.archived_at = timezone.now()
            instance.updated_by = request.user
            instance.save(update_fields=['archived_at', 'updated_by', 'updated_at'])
            record_event(
                organization=self.org, actor=request.user, event_type=f'{self.event_prefix}.archived', instance=instance
            )
        return Response(self.get_serializer(instance).data)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def restore(self, request, pk=None):
        # get_queryset normally hides archived records, so resolve through tenant-scoped base queryset.
        instance = self.queryset.filter(organization=self.org, pk=pk).first()
        if instance is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        self.check_object_permissions(request, instance)
        if instance.archived_at is not None:
            instance.archived_at = None
            instance.updated_by = request.user
            instance.save(update_fields=['archived_at', 'updated_by', 'updated_at'])
            record_event(
                organization=self.org, actor=request.user, event_type=f'{self.event_prefix}.restored', instance=instance
            )
        return Response(self.get_serializer(instance).data)

    @action(detail=False, methods=['post'], url_path='duplicate-check')
    def duplicate_check(self, request):
        candidates = DuplicateDetectionService.check(
            organization=self.org,
            target_type=self.custom_target,
            data={**request.data, 'candidate_type': self.custom_target},
            exclude_id=request.data.get('exclude_id'),
        )
        return Response({'candidates': candidates})

    @action(detail=True, methods=['get'])
    def timeline(self, request, pk=None):
        instance = self.get_object()
        queryset = DomainEvent.objects.filter(
            organization=self.org, object_type=self.custom_target, object_id=instance.pk
        ).select_related('actor')
        page = self.paginate_queryset(queryset)
        serializer = DomainEventSerializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @action(detail=True, methods=['post'], url_path='tags')
    def change_tags(self, request, pk=None):
        instance = self.get_object()
        operation = request.data.get('operation')
        tag_ids = request.data.get('tag_ids')
        if operation not in ('attach', 'detach') or not isinstance(tag_ids, list) or not tag_ids:
            raise serializers.ValidationError('Provide operation attach/detach and a non-empty tag_ids list.')
        tags = list(Tag.objects.filter(organization=self.org, archived_at__isnull=True, id__in=tag_ids))
        if len(tags) != len(set(tag_ids)):
            raise serializers.ValidationError({'tag_ids': 'One or more tags are unavailable.'})
        with transaction.atomic():
            getattr(instance.tags, 'add' if operation == 'attach' else 'remove')(*tags)
            for tag in tags:
                record_event(
                    organization=self.org,
                    actor=request.user,
                    event_type=f'tag.{"attached" if operation == "attach" else "detached"}',
                    instance=instance,
                    metadata={'tag_id': tag.id, 'tag_name': tag.name},
                    audit=False,
                )
        return Response(self.get_serializer(instance).data)

    @action(detail=False, methods=['post'])
    @transaction.atomic
    def bulk(self, request):
        ids = request.data.get('ids')
        operation = request.data.get('operation')
        if not isinstance(ids, list) or not ids:
            raise serializers.ValidationError({'ids': 'A non-empty explicit id list is required.'})
        if len(ids) > self.bulk_limit:
            raise serializers.ValidationError({'ids': f'At most {self.bulk_limit} records may be changed at once.'})
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError({'ids': 'Duplicate ids are not allowed.'})
        instances = list(self.queryset.select_for_update().filter(organization=self.org, id__in=ids))
        if len(instances) != len(ids):
            raise serializers.ValidationError({'ids': 'One or more records are unavailable.'})
        allowed = {'assign_owner', 'assign_team', 'add_tags', 'remove_tags', 'change_status', 'change_lifecycle', 'archive', 'restore'}
        if operation not in allowed:
            raise serializers.ValidationError({'operation': 'Unsupported bulk operation.'})
        with transaction.atomic():
            if operation == 'assign_owner':
                owner_id = request.data.get('owner_id')
                if owner_id is not None and not Membership.objects.filter(
                    organization=self.org, user_id=owner_id, is_active=True
                ).exists():
                    raise serializers.ValidationError({'owner_id': 'Owner must belong to this organization.'})
                for instance in instances:
                    instance.owner_id = owner_id
                    instance.updated_by = request.user
                    instance.save(update_fields=['owner_id', 'updated_by', 'updated_at'])
            elif operation == 'assign_team':
                team_id = request.data.get('team_id')
                if team_id is not None and not Team.objects.filter(
                    organization=self.org, id=team_id, active=True
                ).exists():
                    raise serializers.ValidationError({'team_id': 'Team must belong to this organization.'})
                for instance in instances:
                    instance.team_id = team_id
                    instance.updated_by = request.user
                    instance.save(update_fields=['team_id', 'updated_by', 'updated_at'])
            elif operation in ('add_tags', 'remove_tags'):
                tag_ids = request.data.get('tag_ids') or []
                if len(tag_ids) > 50:
                    raise serializers.ValidationError({'tag_ids': 'At most 50 tags may be changed at once.'})
                tags = list(Tag.objects.filter(organization=self.org, archived_at__isnull=True, id__in=tag_ids))
                if not tag_ids or len(tags) != len(set(tag_ids)):
                    raise serializers.ValidationError({'tag_ids': 'Every tag must belong to this organization.'})
                method = 'add' if operation == 'add_tags' else 'remove'
                for instance in instances:
                    getattr(instance.tags, method)(*tags)
                    for tag in tags:
                        record_event(
                            organization=self.org,
                            actor=request.user,
                            event_type='tag.attached' if operation == 'add_tags' else 'tag.detached',
                            instance=instance,
                            metadata={'tag_id': tag.id, 'tag_name': tag.name, 'bulk': True},
                            audit=False,
                        )
            elif operation in ('change_status', 'change_lifecycle'):
                field = 'status' if operation == 'change_status' else 'lifecycle_stage'
                if not all(hasattr(instance, field) for instance in instances):
                    raise serializers.ValidationError({'operation': 'This field is not supported for the selected object.'})
                value = request.data.get('value')
                if not isinstance(value, str) or not value:
                    raise serializers.ValidationError({'value': 'A non-empty value is required.'})
                model_field = instances[0]._meta.get_field(field)
                choices = {choice for choice, _label in (model_field.choices or [])}
                if choices and value not in choices:
                    raise serializers.ValidationError({'value': 'Value is not an allowed choice.'})
                if field == 'status' and value == 'converted':
                    raise serializers.ValidationError({'value': 'Use lead conversion instead.'})
                for instance in instances:
                    setattr(instance, field, value)
                    instance.updated_by = request.user
                    instance.save(update_fields=[field, 'updated_by', 'updated_at'])
            else:
                archived_at = timezone.now() if operation == 'archive' else None
                for instance in instances:
                    instance.archived_at = archived_at
                    instance.updated_by = request.user
                    instance.save(update_fields=['archived_at', 'updated_by', 'updated_at'])
            for instance in instances:
                record_event(
                    organization=self.org,
                    actor=request.user,
                    event_type=f'{self.event_prefix}.bulk_{operation}',
                    instance=instance,
                    metadata={'bulk_size': len(instances)},
                )
        return Response({'updated': len(instances), 'operation': operation})

from decimal import Decimal

from django.db import transaction
from django.db.models import Max, Sum
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import serializers

from apps.contacts.models import Company, Contact, Tag
from apps.contacts.serializers import CompanyBriefSerializer, TagSerializer
from apps.core.fields import OrgMemberPrimaryKeyRelatedField, TenantPrimaryKeyRelatedField
from apps.core.serializers import UserBriefSerializer
from apps.core.utils import get_membership
from apps.customer_core.models import LeadSource, Team
from apps.customer_core.serializers import CustomerSerializerMixin, TeamBriefSerializer
from apps.leads.models import Lead

from .models import (
    Deal, DealContact, DealLineItem, DealStageHistory, LostReason, Pipeline, Product, Stage,
)
from .services import VersionConflict, add_participant, create_initial_history, save_line_item


class StageSerializer(serializers.ModelSerializer):
    pipeline = TenantPrimaryKeyRelatedField(queryset=Pipeline.objects.filter(active=True, archived_at__isnull=True))
    deals_count = serializers.IntegerField(read_only=True, default=0)
    order = serializers.IntegerField(required=False, min_value=0)

    class Meta:
        model = Stage
        fields = [
            'id', 'pipeline', 'name', 'description', 'order', 'probability', 'stage_type', 'color',
            'active', 'archived_at', 'deals_count', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'active', 'archived_at', 'created_at', 'updated_at']

    def validate(self, attrs):
        stage_type = attrs.get('stage_type', getattr(self.instance, 'stage_type', Stage.Type.OPEN))
        probability = attrs.get('probability', getattr(self.instance, 'probability', 0))
        if stage_type == Stage.Type.WON and probability != 100:
            attrs['probability'] = 100
        elif stage_type == Stage.Type.LOST and probability != 0:
            attrs['probability'] = 0
        pipeline = attrs.get('pipeline', getattr(self.instance, 'pipeline', None))
        if self.instance and pipeline and pipeline.pk != self.instance.pipeline_id:
            raise serializers.ValidationError({'pipeline': 'A stage cannot be moved between pipelines.'})
        if self.instance and 'order' in attrs and attrs['order'] != self.instance.order:
            raise serializers.ValidationError({'order': 'Use the atomic stage reorder operation.'})
        if self.instance and stage_type != self.instance.stage_type and self.instance.deals.exists():
            raise serializers.ValidationError({'stage_type': 'Move every deal before changing stage behavior.'})
        if self.instance is None and pipeline and 'order' not in attrs:
            highest = pipeline.stages.filter(archived_at__isnull=True).aggregate(value=Max('order'))['value']
            attrs['order'] = (highest if highest is not None else -1) + 1
        if pipeline:
            order = attrs.get('order', getattr(self.instance, 'order', 0))
            if pipeline.stages.filter(order=order, archived_at__isnull=True).exclude(
                pk=getattr(self.instance, 'pk', None)
            ).exists():
                raise serializers.ValidationError({'order': 'Another active stage already uses this order.'})
            if stage_type in (Stage.Type.WON, Stage.Type.LOST) and pipeline.stages.filter(
                stage_type=stage_type, active=True, archived_at__isnull=True
            ).exclude(pk=getattr(self.instance, 'pk', None)).exists():
                raise serializers.ValidationError({'stage_type': f'Pipeline already has an active {stage_type} stage.'})
        return attrs


class PipelineSerializer(serializers.ModelSerializer):
    stages = StageSerializer(many=True, read_only=True)
    key = serializers.SlugField(required=False, allow_blank=True, max_length=100)

    class Meta:
        model = Pipeline
        fields = [
            'id', 'name', 'key', 'description', 'is_default', 'active', 'display_order',
            'require_lost_reason', 'stale_activity_days', 'stale_stage_days', 'version',
            'archived_at', 'stages', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'active', 'version', 'archived_at', 'created_at', 'updated_at']

    def validate(self, attrs):
        organization = get_membership(self.context['request']).organization
        name = attrs.get('name', getattr(self.instance, 'name', '')).strip()
        if not name:
            raise serializers.ValidationError({'name': 'Pipeline name is required.'})
        key = attrs.get('key', getattr(self.instance, 'key', '')) or slugify(name)[:100] or 'pipeline'
        if key and Pipeline.objects.filter(organization=organization, key=key).exclude(
            pk=getattr(self.instance, 'pk', None)
        ).exists():
            raise serializers.ValidationError({'key': 'This pipeline key is already in use.'})
        attrs['key'] = key
        return attrs


class PipelineBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Pipeline
        fields = ['id', 'name', 'key', 'is_default', 'active']


class LostReasonSerializer(serializers.ModelSerializer):
    class Meta:
        model = LostReason
        fields = ['id', 'label', 'active', 'display_order', 'archived_at', 'created_at', 'updated_at']
        read_only_fields = ['id', 'active', 'archived_at', 'created_at', 'updated_at']

    def validate_label(self, value):
        organization = get_membership(self.context['request']).organization
        from apps.core.normalization import normalize_name
        if LostReason.objects.filter(organization=organization, normalized_label=normalize_name(value)).exclude(
            pk=getattr(self.instance, 'pk', None)
        ).exists():
            raise serializers.ValidationError('This lost reason already exists.')
        return value.strip()


class ProductSerializer(serializers.ModelSerializer):
    class Meta:
        model = Product
        fields = [
            'id', 'name', 'sku', 'description', 'active', 'default_price', 'currency',
            'archived_at', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'active', 'archived_at', 'created_at', 'updated_at']


class ContactBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contact
        fields = ['id', 'first_name', 'last_name', 'display_name', 'email']
        read_only_fields = fields


class DealContactSerializer(serializers.ModelSerializer):
    contact = TenantPrimaryKeyRelatedField(queryset=Contact.objects.filter(archived_at__isnull=True))
    contact_detail = ContactBriefSerializer(source='contact', read_only=True)

    class Meta:
        model = DealContact
        fields = ['id', 'contact', 'contact_detail', 'role', 'is_primary', 'created_at']
        read_only_fields = ['id', 'created_at']


class DealLineItemSerializer(serializers.ModelSerializer):
    product = TenantPrimaryKeyRelatedField(
        queryset=Product.objects.filter(active=True, archived_at__isnull=True), required=False, allow_null=True
    )
    product_detail = ProductSerializer(source='product', read_only=True)
    name_snapshot = serializers.CharField(required=False, max_length=255)
    sku_snapshot = serializers.CharField(required=False, allow_blank=True, max_length=100)
    unit_price = serializers.DecimalField(max_digits=18, decimal_places=2, required=False, min_value=0)

    class Meta:
        model = DealLineItem
        fields = [
            'id', 'product', 'product_detail', 'name_snapshot', 'sku_snapshot', 'quantity', 'unit_price',
            'discount_type', 'discount_value', 'tax_rate', 'line_total', 'position', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'line_total', 'created_at', 'updated_at']

    def validate(self, attrs):
        if self.instance and any(field in attrs for field in ('product', 'name_snapshot', 'sku_snapshot')):
            raise serializers.ValidationError('Product and snapshots are immutable after creation.')
        product = attrs.get('product', getattr(self.instance, 'product', None))
        name = attrs.get('name_snapshot', getattr(self.instance, 'name_snapshot', ''))
        if self.instance is None and not product and not str(name).strip():
            raise serializers.ValidationError({'name_snapshot': 'Enter a name or select a product.'})
        if self.instance is None and not product and 'unit_price' not in attrs:
            raise serializers.ValidationError({'unit_price': 'Enter a unit price.'})
        return attrs


class DealStageHistorySerializer(serializers.ModelSerializer):
    from_stage_detail = StageSerializer(source='from_stage', read_only=True)
    to_stage_detail = StageSerializer(source='to_stage', read_only=True)
    actor_detail = UserBriefSerializer(source='actor', read_only=True)

    class Meta:
        model = DealStageHistory
        fields = [
            'id', 'pipeline', 'from_stage', 'from_stage_detail', 'to_stage', 'to_stage_detail',
            'entered_at', 'exited_at', 'actor', 'actor_detail',
        ]
        read_only_fields = fields


class DealSerializer(CustomerSerializerMixin, serializers.ModelSerializer):
    custom_target = 'deal'
    custom_fields = serializers.JSONField(required=False)
    pipeline = TenantPrimaryKeyRelatedField(
        queryset=Pipeline.objects.filter(active=True, archived_at__isnull=True)
    )
    pipeline_detail = serializers.SerializerMethodField()
    stage = TenantPrimaryKeyRelatedField(queryset=Stage.objects.filter(active=True, archived_at__isnull=True), required=False)
    stage_detail = StageSerializer(source='stage', read_only=True)
    contact = TenantPrimaryKeyRelatedField(
        queryset=Contact.objects.filter(archived_at__isnull=True), required=False, allow_null=True
    )
    contact_detail = ContactBriefSerializer(source='contact', read_only=True)
    company = TenantPrimaryKeyRelatedField(
        queryset=Company.objects.filter(archived_at__isnull=True), required=False, allow_null=True
    )
    company_detail = CompanyBriefSerializer(source='company', read_only=True)
    source_lead = TenantPrimaryKeyRelatedField(
        queryset=Lead.objects.filter(archived_at__isnull=True), required=False, allow_null=True
    )
    owner = OrgMemberPrimaryKeyRelatedField(required=False, allow_null=True)
    owner_detail = UserBriefSerializer(source='owner', read_only=True)
    team = TenantPrimaryKeyRelatedField(
        queryset=Team.objects.filter(active=True), required=False, allow_null=True
    )
    team_detail = TeamBriefSerializer(source='team', read_only=True)
    tags = TenantPrimaryKeyRelatedField(
        queryset=Tag.objects.filter(archived_at__isnull=True), many=True, required=False
    )
    tags_detail = TagSerializer(source='tags', many=True, read_only=True)
    lost_reason_record = serializers.PrimaryKeyRelatedField(read_only=True)
    lost_reason_detail = LostReasonSerializer(source='lost_reason_record', read_only=True)
    participants = serializers.SerializerMethodField()
    participants_count = serializers.IntegerField(read_only=True, default=0)
    line_items = serializers.SerializerMethodField()
    line_items_count = serializers.IntegerField(read_only=True, default=0)
    amount = serializers.DecimalField(source='value', max_digits=18, decimal_places=2, required=False)
    probability = serializers.IntegerField(source='effective_probability', read_only=True)
    weighted_value = serializers.DecimalField(max_digits=20, decimal_places=2, read_only=True)
    age_days = serializers.SerializerMethodField()
    stage_age_days = serializers.SerializerMethodField()
    days_until_close = serializers.SerializerMethodField()
    overdue_days = serializers.SerializerMethodField()
    is_stale = serializers.SerializerMethodField()
    stale_reasons = serializers.SerializerMethodField()
    expected_version = serializers.IntegerField(write_only=True, required=False, min_value=1)
    last_activity_at = serializers.DateTimeField(read_only=True, allow_null=True)
    next_activity_at = serializers.DateTimeField(read_only=True, allow_null=True)
    next_activity_id = serializers.IntegerField(read_only=True, allow_null=True)
    next_activity_title = serializers.CharField(read_only=True, allow_null=True)
    next_activity_type = serializers.CharField(read_only=True, allow_null=True)
    next_activity_due_date = serializers.DateField(read_only=True, allow_null=True)
    next_activity_all_day = serializers.BooleanField(read_only=True, allow_null=True)

    class Meta:
        model = Deal
        fields = [
            'id', 'title', 'normalized_title', 'description', 'value', 'amount', 'value_mode', 'currency',
            'probability_override', 'probability', 'weighted_value', 'pipeline', 'pipeline_detail', 'stage',
            'stage_detail', 'contact', 'contact_detail', 'company', 'company_detail', 'source_lead', 'owner',
            'owner_detail', 'team', 'team_detail', 'status', 'priority', 'source', 'deal_type',
            'forecast_category', 'expected_close_date', 'actual_close_date', 'closed_at', 'won_at', 'lost_at',
            'abandoned_at', 'reopened_at', 'lost_reason', 'lost_reason_record', 'lost_reason_detail', 'lost_reason_text',
            'stage_entered_at', 'version', 'expected_version', 'archived_at', 'tags', 'tags_detail',
            'participants', 'participants_count', 'line_items', 'line_items_count', 'custom_fields',
            'age_days', 'stage_age_days', 'days_until_close',
            'overdue_days', 'is_stale', 'stale_reasons', 'last_activity_at', 'next_activity_at',
            'next_activity_id', 'next_activity_title', 'next_activity_type', 'created_at', 'updated_at',
            'next_activity_due_date', 'next_activity_all_day',
        ]
        read_only_fields = [
            'id', 'normalized_title', 'status', 'actual_close_date', 'closed_at', 'won_at', 'lost_at',
            'abandoned_at', 'reopened_at', 'lost_reason', 'lost_reason_record', 'lost_reason_text', 'stage_entered_at',
            'version', 'archived_at', 'created_at', 'updated_at',
        ]
        extra_kwargs = {'value': {'required': False}}

    def validate(self, attrs):
        attrs = super().validate(attrs)
        membership = get_membership(self.context['request'])
        owner = attrs.get('owner', getattr(self.instance, 'owner', None))
        if membership.role == 'member' and owner is not None and owner.pk != self.context['request'].user.pk:
            raise serializers.ValidationError({'owner': 'Only a sales manager may assign another owner.'})
        pipeline = attrs.get('pipeline', getattr(self.instance, 'pipeline', None))
        stage = attrs.get('stage', getattr(self.instance, 'stage', None))
        if self.instance and ('pipeline' in attrs or 'stage' in attrs):
            if ('pipeline' in attrs and attrs['pipeline'].id != self.instance.pipeline_id) or (
                'stage' in attrs and attrs['stage'].id != self.instance.stage_id
            ):
                raise serializers.ValidationError('Use the stage or pipeline movement action.')
        if stage and pipeline and stage.pipeline_id != pipeline.id:
            raise serializers.ValidationError({'stage': 'Stage does not belong to the selected pipeline.'})
        if self.instance is None and stage and stage.stage_type not in (Stage.Type.OPEN, Stage.Type.ON_HOLD):
            raise serializers.ValidationError({'stage': 'New deals must start in an open or on-hold stage.'})
        if not stage and pipeline:
            stage = pipeline.stages.filter(
                active=True, archived_at__isnull=True, stage_type__in=(Stage.Type.OPEN, Stage.Type.ON_HOLD)
            ).order_by('order', 'id').first()
            if stage is None:
                raise serializers.ValidationError({'pipeline': 'Pipeline has no active open stage.'})
            attrs['stage'] = stage
        value_mode = attrs.get('value_mode', getattr(self.instance, 'value_mode', Deal.ValueMode.MANUAL))
        if value_mode == Deal.ValueMode.LINE_ITEMS and ('value' in attrs or 'amount' in attrs):
            raise serializers.ValidationError({'value': 'Value is calculated from line items.'})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        expected_version = validated_data.pop('expected_version', None)
        validated_data.pop('status', None)
        if not validated_data.get('currency'):
            validated_data['currency'] = get_membership(self.context['request']).organization.currency
        instance = super().create(validated_data)
        create_initial_history(instance, self.context['request'].user)
        if instance.contact_id:
            add_participant(
                deal=instance, contact=instance.contact, role=DealContact.Role.PRIMARY,
                is_primary=True, actor=self.context['request'].user,
            )
        return instance

    @transaction.atomic
    def update(self, instance, validated_data):
        expected_version = validated_data.pop('expected_version', None)
        locked = Deal.objects.select_for_update().get(organization=instance.organization, pk=instance.pk)
        if expected_version is not None and locked.version != expected_version:
            raise VersionConflict()
        previous_value_mode = locked.value_mode
        locked.version += 1
        validated_data['version'] = locked.version
        previous_contact_id = locked.contact_id
        updated = super().update(locked, validated_data)
        if previous_value_mode != Deal.ValueMode.LINE_ITEMS and updated.value_mode == Deal.ValueMode.LINE_ITEMS:
            updated.value = updated.line_items.aggregate(total=Sum('line_total'))['total'] or Decimal('0')
            updated.save(update_fields=['value', 'updated_at'])
        if updated.contact_id and updated.contact_id != previous_contact_id:
            add_participant(
                deal=updated, contact=updated.contact, role=DealContact.Role.PRIMARY,
                is_primary=True, actor=self.context['request'].user,
            )
            updated.refresh_from_db()
        return updated

    def get_age_days(self, obj):
        return max(0, (timezone.localdate() - obj.created_at.date()).days)

    def get_pipeline_detail(self, obj):
        view = self.context.get('view')
        if getattr(view, 'action', None) == 'retrieve':
            return PipelineSerializer(obj.pipeline, context=self.context).data
        return PipelineBriefSerializer(obj.pipeline, context=self.context).data

    def get_participants(self, obj):
        if getattr(self.context.get('view'), 'action', None) != 'retrieve':
            return []
        queryset = obj.participants.select_related('contact').order_by('-is_primary', 'id')[:100]
        return DealContactSerializer(queryset, many=True, context=self.context).data

    def get_line_items(self, obj):
        if getattr(self.context.get('view'), 'action', None) != 'retrieve':
            return []
        queryset = obj.line_items.select_related('product').order_by('position', 'id')[:100]
        return DealLineItemSerializer(queryset, many=True, context=self.context).data

    def get_stage_age_days(self, obj):
        return max(0, (timezone.localdate() - obj.stage_entered_at.date()).days)

    def get_days_until_close(self, obj):
        return (obj.expected_close_date - timezone.localdate()).days if obj.expected_close_date else None

    def get_overdue_days(self, obj):
        days = self.get_days_until_close(obj)
        return abs(days) if days is not None and days < 0 and obj.status == Deal.Status.OPEN else 0

    def get_stale_reasons(self, obj):
        if obj.status != Deal.Status.OPEN:
            return []
        reasons = []
        if self.get_overdue_days(obj):
            reasons.append('expected_close_overdue')
        if self.get_stage_age_days(obj) >= obj.pipeline.stale_stage_days:
            reasons.append('stage_age_threshold')
        last_activity = getattr(obj, 'last_activity_at', None)
        reference = last_activity or obj.created_at
        if (timezone.now() - reference).days >= obj.pipeline.stale_activity_days:
            reasons.append('no_meaningful_activity')
        return reasons

    def get_is_stale(self, obj):
        return bool(self.get_stale_reasons(obj))


class MoveDealSerializer(serializers.Serializer):
    stage = TenantPrimaryKeyRelatedField(queryset=Stage.objects.filter(active=True, archived_at__isnull=True))
    expected_version = serializers.IntegerField(required=False, min_value=1)
    lost_reason = TenantPrimaryKeyRelatedField(
        queryset=LostReason.objects.filter(active=True, archived_at__isnull=True), required=False, allow_null=True
    )
    lost_reason_text = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    actual_close_date = serializers.DateField(required=False)


class ReopenDealSerializer(serializers.Serializer):
    stage = TenantPrimaryKeyRelatedField(queryset=Stage.objects.filter(active=True, archived_at__isnull=True))
    expected_version = serializers.IntegerField(required=False, min_value=1)

    def validate_stage(self, stage):
        if stage.stage_type not in (Stage.Type.OPEN, Stage.Type.ON_HOLD):
            raise serializers.ValidationError('Reopen into an open or on-hold stage.')
        return stage


class ReorderStagesSerializer(serializers.Serializer):
    stage_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), allow_empty=False, max_length=200)
    expected_version = serializers.IntegerField(required=False, min_value=1)


class ParticipantInputSerializer(serializers.Serializer):
    contact = TenantPrimaryKeyRelatedField(queryset=Contact.objects.filter(archived_at__isnull=True))
    role = serializers.ChoiceField(choices=DealContact.Role.choices, default=DealContact.Role.OTHER)
    is_primary = serializers.BooleanField(default=False)

    def validate(self, attrs):
        if attrs['role'] == DealContact.Role.PRIMARY:
            attrs['is_primary'] = True
        return attrs


class LineItemInputSerializer(DealLineItemSerializer):
    def create(self, validated_data):
        deal = self.context['deal']
        return save_line_item(deal=deal, actor=self.context['request'].user, data=validated_data)

    def update(self, instance, validated_data):
        return save_line_item(
            deal=instance.deal, actor=self.context['request'].user, data=validated_data, instance=instance
        )

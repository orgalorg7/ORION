from rest_framework import serializers

from apps.contacts.models import Company, Contact, Tag
from apps.contacts.serializers import CompanyBriefSerializer, TagSerializer
from apps.core.fields import OrgMemberPrimaryKeyRelatedField, TenantPrimaryKeyRelatedField
from apps.core.serializers import UserBriefSerializer
from apps.core.utils import get_membership

from .models import Deal, Pipeline, Stage


class StageSerializer(serializers.ModelSerializer):
    pipeline = TenantPrimaryKeyRelatedField(queryset=Pipeline.objects.all())

    class Meta:
        model = Stage
        fields = ['id', 'pipeline', 'name', 'order', 'probability', 'color']
        read_only_fields = ['id']


class PipelineSerializer(serializers.ModelSerializer):
    stages = StageSerializer(many=True, read_only=True)

    class Meta:
        model = Pipeline
        fields = ['id', 'name', 'is_default', 'stages']
        read_only_fields = ['id']


class ContactBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contact
        fields = ['id', 'first_name', 'last_name']
        read_only_fields = fields


class DealSerializer(serializers.ModelSerializer):
    pipeline = TenantPrimaryKeyRelatedField(queryset=Pipeline.objects.all())
    stage = TenantPrimaryKeyRelatedField(queryset=Stage.objects.all(), required=False, allow_null=True)
    stage_detail = StageSerializer(source='stage', read_only=True)
    contact = TenantPrimaryKeyRelatedField(queryset=Contact.objects.all(), required=False, allow_null=True)
    contact_detail = ContactBriefSerializer(source='contact', read_only=True)
    company = TenantPrimaryKeyRelatedField(queryset=Company.objects.all(), required=False, allow_null=True)
    company_detail = CompanyBriefSerializer(source='company', read_only=True)
    owner = OrgMemberPrimaryKeyRelatedField(required=False, allow_null=True)
    owner_detail = UserBriefSerializer(source='owner', read_only=True)
    tags = TenantPrimaryKeyRelatedField(queryset=Tag.objects.all(), many=True, required=False)
    tags_detail = TagSerializer(source='tags', many=True, read_only=True)

    class Meta:
        model = Deal
        fields = [
            'id', 'title', 'value', 'currency', 'pipeline', 'stage', 'stage_detail',
            'contact', 'contact_detail', 'company', 'company_detail', 'owner', 'owner_detail',
            'status', 'expected_close_date', 'closed_at', 'lost_reason', 'description',
            'tags', 'tags_detail', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'status', 'closed_at', 'created_at', 'updated_at']

    def validate(self, attrs):
        stage = attrs.get('stage')
        if stage is not None:
            pipeline = attrs.get('pipeline') or (self.instance.pipeline if self.instance else None)
            if pipeline is None or stage.pipeline_id != pipeline.id:
                raise serializers.ValidationError({'stage': 'Stage does not belong to the selected pipeline.'})
        return attrs

    def create(self, validated_data):
        if not validated_data.get('stage'):
            validated_data['stage'] = validated_data['pipeline'].stages.order_by('order', 'id').first()
        if not validated_data.get('currency'):
            membership = get_membership(self.context['request'])
            validated_data['currency'] = membership.organization.currency
        return super().create(validated_data)

from rest_framework import serializers

from apps.contacts.models import Company, Contact, Tag
from apps.contacts.serializers import CompanyBriefSerializer, TagSerializer
from apps.core.fields import OrgMemberPrimaryKeyRelatedField, TenantPrimaryKeyRelatedField
from apps.core.serializers import UserBriefSerializer
from apps.customer_core.models import LeadSource, Team
from apps.customer_core.serializers import CustomerSerializerMixin, LeadSourceSerializer, TeamBriefSerializer
from apps.deals.models import Pipeline, Stage

from .models import Lead


class LeadSerializer(CustomerSerializerMixin, serializers.ModelSerializer):
    custom_target = 'lead'
    custom_fields = serializers.JSONField(required=False)
    company = TenantPrimaryKeyRelatedField(queryset=Company.objects.filter(archived_at__isnull=True), required=False, allow_null=True)
    company_detail = CompanyBriefSerializer(source='company', read_only=True)
    owner = OrgMemberPrimaryKeyRelatedField(required=False, allow_null=True)
    owner_detail = UserBriefSerializer(source='owner', read_only=True)
    team = TenantPrimaryKeyRelatedField(queryset=Team.objects.filter(active=True), required=False, allow_null=True)
    team_detail = TeamBriefSerializer(source='team', read_only=True)
    source_record = TenantPrimaryKeyRelatedField(queryset=LeadSource.objects.filter(active=True), required=False, allow_null=True)
    source_detail = LeadSourceSerializer(source='source_record', read_only=True)
    tags = TenantPrimaryKeyRelatedField(queryset=Tag.objects.filter(archived_at__isnull=True), many=True, required=False)
    tags_detail = TagSerializer(source='tags', many=True, read_only=True)
    last_activity_at = serializers.DateTimeField(read_only=True, allow_null=True)
    next_activity_at = serializers.DateTimeField(read_only=True, allow_null=True)
    next_activity_id = serializers.IntegerField(read_only=True, allow_null=True)
    next_activity_title = serializers.CharField(read_only=True, allow_null=True)
    next_activity_type = serializers.CharField(read_only=True, allow_null=True)
    next_activity_due_date = serializers.DateField(read_only=True, allow_null=True)
    next_activity_all_day = serializers.BooleanField(read_only=True, allow_null=True)

    class Meta:
        model = Lead
        fields = [
            'id', 'first_name', 'last_name', 'display_name', 'normalized_name', 'email', 'normalized_email',
            'phone', 'normalized_phone', 'secondary_phone', 'job_title', 'company_name', 'company',
            'company_detail', 'estimated_value', 'currency', 'score', 'score_breakdown', 'temperature', 'source',
            'source_record', 'source_detail', 'lifecycle_stage', 'status', 'owner', 'owner_detail', 'team',
            'team_detail', 'country', 'city', 'address', 'timezone', 'language', 'preferred_channel',
            'description', 'tags', 'tags_detail', 'custom_fields', 'archived_at', 'converted_at',
            'converted_contact', 'converted_company', 'converted_deal', 'utm_source', 'utm_medium',
            'utm_campaign', 'utm_term', 'utm_content', 'last_activity_at', 'next_activity_at',
            'next_activity_id', 'next_activity_title', 'next_activity_type', 'created_at', 'updated_at',
            'next_activity_due_date', 'next_activity_all_day',
        ]
        read_only_fields = [
            'id', 'normalized_name', 'normalized_email', 'normalized_phone', 'score', 'score_breakdown',
            'archived_at', 'converted_at', 'converted_contact', 'converted_company', 'converted_deal',
            'created_at', 'updated_at',
        ]

    def validate_status(self, value):
        already_converted = self.instance is not None and self.instance.status == Lead.Status.CONVERTED
        if value == Lead.Status.CONVERTED and not already_converted:
            raise serializers.ValidationError('Use the convert action to mark a lead as converted.')
        return value


class LeadConvertSerializer(serializers.Serializer):
    existing_contact = TenantPrimaryKeyRelatedField(
        queryset=Contact.objects.filter(archived_at__isnull=True), required=False, allow_null=True
    )
    create_contact = serializers.BooleanField(default=True)
    existing_company = TenantPrimaryKeyRelatedField(
        queryset=Company.objects.filter(archived_at__isnull=True), required=False, allow_null=True
    )
    create_company = serializers.BooleanField(default=True)
    allow_duplicates = serializers.BooleanField(default=False)
    create_deal = serializers.BooleanField(default=False)
    deal_title = serializers.CharField(required=False, allow_blank=True)
    deal_value = serializers.DecimalField(max_digits=18, decimal_places=2, required=False, allow_null=True)
    pipeline = TenantPrimaryKeyRelatedField(queryset=Pipeline.objects.all(), required=False, allow_null=True)
    stage = TenantPrimaryKeyRelatedField(queryset=Stage.objects.all(), required=False, allow_null=True)

    def validate(self, attrs):
        if attrs.get('existing_contact') and attrs.get('create_contact'):
            attrs['create_contact'] = False
        if not attrs.get('existing_contact') and not attrs.get('create_contact'):
            raise serializers.ValidationError('Conversion requires a new or existing contact.')
        if attrs.get('existing_company') and attrs.get('create_company'):
            attrs['create_company'] = False
        return attrs

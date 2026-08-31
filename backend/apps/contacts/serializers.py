from rest_framework import serializers

from apps.core.fields import OrgMemberPrimaryKeyRelatedField, TenantPrimaryKeyRelatedField
from apps.core.normalization import normalize_domain, normalize_name
from apps.core.serializers import UserBriefSerializer
from apps.core.utils import get_membership
from apps.customer_core.models import LeadSource, Team
from apps.customer_core.serializers import (
    CustomerSerializerMixin,
    LeadSourceSerializer,
    TeamBriefSerializer,
)

from .models import Company, Contact, Tag


class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ['id', 'name', 'color', 'archived_at', 'created_at', 'updated_at']
        read_only_fields = ['id', 'archived_at', 'created_at', 'updated_at']

    def validate_name(self, value):
        normalized = normalize_name(value)
        if not normalized:
            raise serializers.ValidationError('Tag name may not be blank.')
        request = self.context.get('request')
        if request:
            organization = get_membership(request).organization
            queryset = Tag.objects.filter(organization=organization, normalized_name=normalized)
            if self.instance:
                queryset = queryset.exclude(pk=self.instance.pk)
            if queryset.exists():
                raise serializers.ValidationError('A tag with this normalized name already exists.')
        return value.strip()


class CompanyBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Company
        fields = ['id', 'name', 'domain']
        read_only_fields = fields


class CompanySerializer(CustomerSerializerMixin, serializers.ModelSerializer):
    custom_target = 'company'
    custom_fields = serializers.JSONField(required=False)
    owner = OrgMemberPrimaryKeyRelatedField(required=False, allow_null=True)
    owner_detail = UserBriefSerializer(source='owner', read_only=True)
    team = TenantPrimaryKeyRelatedField(queryset=Team.objects.filter(active=True), required=False, allow_null=True)
    team_detail = TeamBriefSerializer(source='team', read_only=True)
    source_record = TenantPrimaryKeyRelatedField(queryset=LeadSource.objects.filter(active=True), required=False, allow_null=True)
    source_detail = LeadSourceSerializer(source='source_record', read_only=True)
    tags = TenantPrimaryKeyRelatedField(queryset=Tag.objects.filter(archived_at__isnull=True), many=True, required=False)
    tags_detail = TagSerializer(source='tags', many=True, read_only=True)
    contacts_count = serializers.IntegerField(read_only=True, default=0)
    primary_phone = serializers.CharField(source='phone', required=False, allow_blank=True)
    last_activity_at = serializers.DateTimeField(read_only=True, allow_null=True)
    next_activity_at = serializers.DateTimeField(read_only=True, allow_null=True)
    next_activity_id = serializers.IntegerField(read_only=True, allow_null=True)
    next_activity_title = serializers.CharField(read_only=True, allow_null=True)
    next_activity_type = serializers.CharField(read_only=True, allow_null=True)
    next_activity_due_date = serializers.DateField(read_only=True, allow_null=True)
    next_activity_all_day = serializers.BooleanField(read_only=True, allow_null=True)

    class Meta:
        model = Company
        fields = [
            'id', 'name', 'normalized_name', 'legal_name', 'domain', 'normalized_domain', 'website',
            'phone', 'primary_phone', 'normalized_phone', 'email', 'normalized_email', 'industry', 'size',
            'employee_count', 'annual_revenue', 'currency', 'country', 'city', 'address', 'lifecycle_stage',
            'source', 'source_record', 'source_detail', 'description', 'owner', 'owner_detail', 'team',
            'team_detail', 'tags', 'tags_detail', 'contacts_count', 'custom_fields', 'archived_at',
            'last_activity_at', 'next_activity_at', 'next_activity_id', 'next_activity_title',
            'next_activity_type', 'created_at', 'updated_at',
            'next_activity_due_date', 'next_activity_all_day',
        ]
        read_only_fields = [
            'id', 'normalized_name', 'normalized_domain', 'normalized_phone', 'normalized_email',
            'archived_at', 'created_at', 'updated_at',
        ]
        extra_kwargs = {'phone': {'required': False, 'allow_blank': True}}

    def validate(self, attrs):
        try:
            normalize_domain(attrs.get('domain') or attrs.get('website') or getattr(self.instance, 'domain', ''))
        except Exception as exc:
            raise serializers.ValidationError({'domain': str(exc)}) from exc
        return super().validate(attrs)


class ContactSerializer(CustomerSerializerMixin, serializers.ModelSerializer):
    custom_target = 'contact'
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
    primary_email = serializers.EmailField(source='email', required=False, allow_blank=True)
    primary_phone = serializers.CharField(source='phone', required=False, allow_blank=True)
    last_activity_at = serializers.DateTimeField(read_only=True, allow_null=True)
    next_activity_at = serializers.DateTimeField(read_only=True, allow_null=True)
    next_activity_id = serializers.IntegerField(read_only=True, allow_null=True)
    next_activity_title = serializers.CharField(read_only=True, allow_null=True)
    next_activity_type = serializers.CharField(read_only=True, allow_null=True)
    next_activity_due_date = serializers.DateField(read_only=True, allow_null=True)
    next_activity_all_day = serializers.BooleanField(read_only=True, allow_null=True)

    class Meta:
        model = Contact
        fields = [
            'id', 'first_name', 'last_name', 'display_name', 'normalized_name', 'email', 'primary_email',
            'normalized_email', 'phone', 'primary_phone', 'normalized_phone', 'secondary_phone', 'job_title',
            'department', 'company', 'company_detail', 'owner', 'owner_detail', 'team', 'team_detail',
            'source', 'source_record', 'source_detail', 'lifecycle_stage', 'preferred_channel', 'language',
            'timezone', 'address', 'city', 'country', 'description', 'is_active', 'tags', 'tags_detail',
            'custom_fields', 'archived_at', 'last_activity_at', 'next_activity_at', 'next_activity_id',
            'next_activity_title', 'next_activity_type', 'created_at', 'updated_at',
            'next_activity_due_date', 'next_activity_all_day',
        ]
        read_only_fields = [
            'id', 'normalized_name', 'normalized_email', 'normalized_phone', 'archived_at',
            'created_at', 'updated_at',
        ]
        extra_kwargs = {
            'email': {'required': False, 'allow_blank': True},
            'phone': {'required': False, 'allow_blank': True},
        }

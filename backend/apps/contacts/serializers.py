from rest_framework import serializers

from apps.core.fields import OrgMemberPrimaryKeyRelatedField, TenantPrimaryKeyRelatedField
from apps.core.serializers import UserBriefSerializer

from .models import Company, Contact, Tag


class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ['id', 'name', 'color', 'created_at']
        read_only_fields = ['id', 'created_at']


class CompanyBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Company
        fields = ['id', 'name']
        read_only_fields = fields


class CompanySerializer(serializers.ModelSerializer):
    owner = OrgMemberPrimaryKeyRelatedField(required=False, allow_null=True)
    owner_detail = UserBriefSerializer(source='owner', read_only=True)
    tags = TenantPrimaryKeyRelatedField(queryset=Tag.objects.all(), many=True, required=False)
    tags_detail = TagSerializer(source='tags', many=True, read_only=True)
    contacts_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Company
        fields = [
            'id', 'name', 'domain', 'industry', 'size', 'website', 'email', 'phone',
            'address', 'city', 'country', 'annual_revenue', 'description',
            'owner', 'owner_detail', 'tags', 'tags_detail', 'contacts_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class ContactSerializer(serializers.ModelSerializer):
    company = TenantPrimaryKeyRelatedField(queryset=Company.objects.all(), required=False, allow_null=True)
    company_detail = CompanyBriefSerializer(source='company', read_only=True)
    owner = OrgMemberPrimaryKeyRelatedField(required=False, allow_null=True)
    owner_detail = UserBriefSerializer(source='owner', read_only=True)
    tags = TenantPrimaryKeyRelatedField(queryset=Tag.objects.all(), many=True, required=False)
    tags_detail = TagSerializer(source='tags', many=True, read_only=True)

    class Meta:
        model = Contact
        fields = [
            'id', 'first_name', 'last_name', 'email', 'phone', 'job_title',
            'company', 'company_detail', 'owner', 'owner_detail', 'source',
            'address', 'city', 'country', 'description', 'is_active',
            'tags', 'tags_detail', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

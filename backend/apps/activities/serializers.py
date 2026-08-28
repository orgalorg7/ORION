from rest_framework import serializers

from apps.contacts.models import Company, Contact
from apps.core.fields import OrgMemberPrimaryKeyRelatedField, TenantPrimaryKeyRelatedField
from apps.core.serializers import UserBriefSerializer
from apps.deals.models import Deal
from apps.leads.models import Lead

from .models import Activity, Note


class ContactBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contact
        fields = ['id', 'first_name', 'last_name']
        read_only_fields = fields


class CompanyBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Company
        fields = ['id', 'name']
        read_only_fields = fields


class DealBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Deal
        fields = ['id', 'title']
        read_only_fields = fields


class LeadBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lead
        fields = ['id', 'first_name', 'last_name']
        read_only_fields = fields


class ActivitySerializer(serializers.ModelSerializer):
    assigned_to = OrgMemberPrimaryKeyRelatedField(required=False, allow_null=True)
    assigned_to_detail = UserBriefSerializer(source='assigned_to', read_only=True)
    contact = TenantPrimaryKeyRelatedField(queryset=Contact.objects.all(), required=False, allow_null=True)
    contact_detail = ContactBriefSerializer(source='contact', read_only=True)
    company = TenantPrimaryKeyRelatedField(queryset=Company.objects.all(), required=False, allow_null=True)
    company_detail = CompanyBriefSerializer(source='company', read_only=True)
    deal = TenantPrimaryKeyRelatedField(queryset=Deal.objects.all(), required=False, allow_null=True)
    deal_detail = DealBriefSerializer(source='deal', read_only=True)
    lead = TenantPrimaryKeyRelatedField(queryset=Lead.objects.all(), required=False, allow_null=True)
    lead_detail = LeadBriefSerializer(source='lead', read_only=True)

    class Meta:
        model = Activity
        fields = [
            'id', 'type', 'title', 'description', 'due_at', 'completed', 'completed_at',
            'assigned_to', 'assigned_to_detail', 'contact', 'contact_detail',
            'company', 'company_detail', 'deal', 'deal_detail', 'lead', 'lead_detail',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'completed_at', 'created_at', 'updated_at']


class NoteSerializer(serializers.ModelSerializer):
    author_detail = UserBriefSerializer(source='author', read_only=True)
    contact = TenantPrimaryKeyRelatedField(queryset=Contact.objects.all(), required=False, allow_null=True)
    company = TenantPrimaryKeyRelatedField(queryset=Company.objects.all(), required=False, allow_null=True)
    deal = TenantPrimaryKeyRelatedField(queryset=Deal.objects.all(), required=False, allow_null=True)
    lead = TenantPrimaryKeyRelatedField(queryset=Lead.objects.all(), required=False, allow_null=True)

    class Meta:
        model = Note
        fields = [
            'id', 'body', 'author', 'author_detail',
            'contact', 'company', 'deal', 'lead',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'author', 'created_at', 'updated_at']

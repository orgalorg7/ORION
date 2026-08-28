from rest_framework import serializers

from apps.core.fields import OrgMemberPrimaryKeyRelatedField, TenantPrimaryKeyRelatedField
from apps.core.serializers import UserBriefSerializer
from apps.deals.models import Pipeline, Stage

from .models import Lead


class LeadSerializer(serializers.ModelSerializer):
    owner = OrgMemberPrimaryKeyRelatedField(required=False, allow_null=True)
    owner_detail = UserBriefSerializer(source='owner', read_only=True)

    class Meta:
        model = Lead
        fields = [
            'id', 'first_name', 'last_name', 'email', 'phone', 'company_name',
            'job_title', 'source', 'status', 'score', 'estimated_value',
            'owner', 'owner_detail', 'description',
            'converted_at', 'converted_contact', 'converted_deal',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'converted_at', 'converted_contact', 'converted_deal',
            'created_at', 'updated_at',
        ]

    def validate_status(self, value):
        already_converted = self.instance is not None and self.instance.status == Lead.Status.CONVERTED
        if value == Lead.Status.CONVERTED and not already_converted:
            raise serializers.ValidationError('Use the convert action to mark a lead as converted.')
        return value


class LeadConvertSerializer(serializers.Serializer):
    create_deal = serializers.BooleanField(default=False)
    deal_title = serializers.CharField(required=False, allow_blank=True)
    deal_value = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True)
    pipeline = TenantPrimaryKeyRelatedField(queryset=Pipeline.objects.all(), required=False, allow_null=True)
    stage = TenantPrimaryKeyRelatedField(queryset=Stage.objects.all(), required=False, allow_null=True)

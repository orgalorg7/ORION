from rest_framework import serializers

from apps.contacts.models import Contact
from apps.core.fields import OrgMemberPrimaryKeyRelatedField, TenantPrimaryKeyRelatedField
from apps.core.serializers import UserBriefSerializer

from .models import Ticket, TicketComment


class ContactBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contact
        fields = ['id', 'first_name', 'last_name']
        read_only_fields = fields


class TicketCommentSerializer(serializers.ModelSerializer):
    author_detail = UserBriefSerializer(source='author', read_only=True)

    class Meta:
        model = TicketComment
        fields = ['id', 'author', 'author_detail', 'body', 'is_internal', 'created_at']
        read_only_fields = ['id', 'author', 'created_at']


class TicketSerializer(serializers.ModelSerializer):
    contact = TenantPrimaryKeyRelatedField(queryset=Contact.objects.all(), required=False, allow_null=True)
    contact_detail = ContactBriefSerializer(source='contact', read_only=True)
    assigned_to = OrgMemberPrimaryKeyRelatedField(required=False, allow_null=True)
    assigned_to_detail = UserBriefSerializer(source='assigned_to', read_only=True)
    comments_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Ticket
        fields = [
            'id', 'number', 'subject', 'description', 'contact', 'contact_detail',
            'status', 'priority', 'category', 'assigned_to', 'assigned_to_detail',
            'comments_count', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'number', 'created_at', 'updated_at']

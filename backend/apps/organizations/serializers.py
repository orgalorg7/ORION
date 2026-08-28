from rest_framework import serializers

from apps.core.serializers import UserBriefSerializer

from .models import Invitation, Membership, Organization, Plan, Subscription


class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = [
            'id', 'name', 'slug', 'industry', 'size', 'country', 'website',
            'currency', 'default_language', 'created_at',
        ]
        read_only_fields = ['id', 'slug', 'created_at']


class MembershipBriefSerializer(serializers.ModelSerializer):
    """Used by /auth/me/ — the user's own memberships with org info."""

    organization = OrganizationSerializer(read_only=True)

    class Meta:
        model = Membership
        fields = ['id', 'role', 'is_active', 'organization']


class MembershipSerializer(serializers.ModelSerializer):
    """Used by the team settings page — members of the active org."""

    user = UserBriefSerializer(read_only=True)

    class Meta:
        model = Membership
        fields = ['id', 'role', 'is_active', 'user', 'created_at']
        read_only_fields = ['id', 'user', 'created_at']


class PlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = Plan
        fields = [
            'id', 'code', 'name', 'name_ar', 'price_monthly', 'max_users',
            'max_contacts', 'features', 'is_default', 'sort_order',
        ]


class SubscriptionSerializer(serializers.ModelSerializer):
    plan = PlanSerializer(read_only=True)

    class Meta:
        model = Subscription
        fields = ['id', 'plan', 'status', 'trial_end', 'current_period_end', 'cancel_at_period_end']


class InvitationSerializer(serializers.ModelSerializer):
    invited_by = UserBriefSerializer(read_only=True)

    class Meta:
        model = Invitation
        fields = ['id', 'email', 'role', 'invited_by', 'accepted_at', 'created_at']
        read_only_fields = ['id', 'invited_by', 'accepted_at', 'created_at']

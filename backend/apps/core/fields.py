from django.contrib.auth import get_user_model
from rest_framework import serializers

from .utils import get_membership


class TenantPrimaryKeyRelatedField(serializers.PrimaryKeyRelatedField):
    """PrimaryKeyRelatedField whose queryset is scoped to the request's org.

    Usage: ``company = TenantPrimaryKeyRelatedField(queryset=Company.objects.all(), ...)``
    """

    def get_queryset(self):
        queryset = super().get_queryset()
        request = self.context.get('request')
        if queryset is None or request is None:
            return queryset
        membership = get_membership(request)
        if membership is None:
            return queryset.none()
        return queryset.filter(organization=membership.organization)


class OrgMemberPrimaryKeyRelatedField(serializers.PrimaryKeyRelatedField):
    """Related field for User FKs (owner / assigned_to), scoped to org members."""

    def __init__(self, **kwargs):
        kwargs.setdefault('queryset', get_user_model().objects.all())
        super().__init__(**kwargs)

    def get_queryset(self):
        request = self.context.get('request')
        if request is None:
            return get_user_model().objects.none()
        membership = get_membership(request)
        if membership is None:
            return get_user_model().objects.none()
        return get_user_model().objects.filter(
            memberships__organization=membership.organization,
            memberships__is_active=True,
        ).distinct()

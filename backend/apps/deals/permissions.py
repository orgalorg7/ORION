from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.core.utils import get_membership


MANAGE_ROLES = ('owner', 'admin')
SALES_LEAD_ROLES = ('owner', 'admin', 'manager')


class DealPermission(BasePermission):
    """Active members may sell; members may only mutate their own or unassigned deals."""

    def has_permission(self, request, view):
        membership = get_membership(request)
        if not membership:
            return False
        if view.action in ('bulk',) and membership.role not in SALES_LEAD_ROLES:
            return False
        return True

    def has_object_permission(self, request, view, obj):
        membership = get_membership(request)
        if not membership:
            return False
        if request.method in SAFE_METHODS:
            return True
        return membership.role in SALES_LEAD_ROLES or obj.owner_id in (None, request.user.id)


class ConfigurationPermission(BasePermission):
    """Pipeline/product configuration is readable by members and writable by admins."""

    def has_permission(self, request, view):
        membership = get_membership(request)
        if not membership:
            return False
        return request.method in SAFE_METHODS or membership.role in MANAGE_ROLES

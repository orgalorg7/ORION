from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.core.utils import get_membership


LEAD_ROLES = ('owner', 'admin', 'manager')


class ActivityPermission(BasePermission):
    """Members work their own/unassigned activities; leads can manage tenant work."""

    def has_permission(self, request, view):
        membership = get_membership(request)
        if not membership:
            return False
        if getattr(view, 'action', None) in ('bulk', 'analytics') and membership.role not in LEAD_ROLES:
            return False
        return True

    def has_object_permission(self, request, view, obj):
        membership = get_membership(request)
        if not membership:
            return False
        target = getattr(obj, 'template_activity', obj)
        if target is None:
            return False
        if request.method in SAFE_METHODS:
            return True
        if membership.role in LEAD_ROLES:
            return True
        if target.assigned_to_id in (None, request.user.id):
            return True
        return target.attendees.filter(user=request.user).exists() and view.action in ('complete', 'reschedule')


class ActivityConfigurationPermission(BasePermission):
    def has_permission(self, request, view):
        membership = get_membership(request)
        return bool(membership and (request.method in SAFE_METHODS or membership.role in ('owner', 'admin')))

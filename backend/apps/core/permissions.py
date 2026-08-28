from rest_framework.permissions import BasePermission

from .utils import get_membership

ADMIN_ROLES = ('owner', 'admin')


class IsOrgMember(BasePermission):
    message = 'You are not an active member of this organization.'

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and get_membership(request))


class IsOrgAdmin(BasePermission):
    message = 'This action requires an owner or admin role.'

    def has_permission(self, request, view):
        membership = get_membership(request)
        return bool(membership and membership.role in ADMIN_ROLES)

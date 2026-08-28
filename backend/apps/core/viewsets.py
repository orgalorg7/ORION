from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from .permissions import IsOrgMember
from .utils import get_membership


class TenantViewSet(viewsets.ModelViewSet):
    """ModelViewSet scoped to the request's organization.

    Subclasses set ``queryset`` and ``serializer_class`` as usual; every query
    is filtered to the active organization and creates are stamped with the
    organization and the requesting user.
    """

    permission_classes = [IsAuthenticated, IsOrgMember]

    @property
    def org(self):
        return get_membership(self.request).organization

    def get_queryset(self):
        return super().get_queryset().filter(organization=self.org)

    def perform_create(self, serializer):
        serializer.save(organization=self.org, created_by=self.request.user)

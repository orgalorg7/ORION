import django_filters
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.viewsets import TenantViewSet

from .models import Activity, Note
from .serializers import ActivitySerializer, NoteSerializer


class ActivityFilterSet(django_filters.FilterSet):
    due_before = django_filters.DateTimeFilter(field_name='due_at', lookup_expr='lte')
    due_after = django_filters.DateTimeFilter(field_name='due_at', lookup_expr='gte')

    class Meta:
        model = Activity
        fields = ['type', 'completed', 'assigned_to', 'contact', 'company', 'deal', 'lead']


class ActivityViewSet(TenantViewSet):
    queryset = Activity.objects.all()
    serializer_class = ActivitySerializer
    filterset_class = ActivityFilterSet
    search_fields = ['title', 'description']
    ordering_fields = ['due_at', 'created_at']

    def get_queryset(self):
        return super().get_queryset().select_related('assigned_to', 'contact', 'company', 'deal', 'lead')

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        activity = self.get_object()
        completed = bool(request.data.get('completed', True))
        activity.completed = completed
        activity.completed_at = timezone.now() if completed else None
        activity.save(update_fields=['completed', 'completed_at', 'updated_at'])
        return Response(self.get_serializer(activity).data)


class NoteViewSet(TenantViewSet):
    queryset = Note.objects.all()
    serializer_class = NoteSerializer
    filterset_fields = ['contact', 'company', 'deal', 'lead']
    ordering_fields = ['created_at']

    def get_queryset(self):
        return super().get_queryset().select_related('author', 'contact', 'company', 'deal', 'lead')

    def perform_create(self, serializer):
        serializer.save(organization=self.org, created_by=self.request.user, author=self.request.user)

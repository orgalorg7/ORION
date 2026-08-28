from django.db.models import Count
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.viewsets import TenantViewSet

from .models import Ticket
from .serializers import TicketCommentSerializer, TicketSerializer


class TicketViewSet(TenantViewSet):
    queryset = Ticket.objects.all()
    serializer_class = TicketSerializer
    filterset_fields = ['status', 'priority', 'category', 'assigned_to', 'contact']
    search_fields = ['subject', 'description']
    ordering_fields = ['created_at', 'updated_at', 'priority']

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .select_related('contact', 'assigned_to')
            .annotate(comments_count=Count('comments', distinct=True))
        )

    @action(detail=True, methods=['get', 'post'], url_path='comments')
    def comments(self, request, pk=None):
        ticket = self.get_object()
        if request.method == 'POST':
            serializer = TicketCommentSerializer(data=request.data, context=self.get_serializer_context())
            serializer.is_valid(raise_exception=True)
            serializer.save(ticket=ticket, author=request.user)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        comments = ticket.comments.select_related('author').order_by('created_at')
        serializer = TicketCommentSerializer(comments, many=True, context=self.get_serializer_context())
        return Response(serializer.data)

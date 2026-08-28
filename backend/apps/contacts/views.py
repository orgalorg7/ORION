from django.db.models import Count

from apps.core.viewsets import TenantViewSet

from .models import Company, Contact, Tag
from .serializers import CompanySerializer, ContactSerializer, TagSerializer


class TagViewSet(TenantViewSet):
    queryset = Tag.objects.all()
    serializer_class = TagSerializer
    search_fields = ['name']
    pagination_class = None


class CompanyViewSet(TenantViewSet):
    queryset = Company.objects.all()
    serializer_class = CompanySerializer
    filterset_fields = ['industry', 'size', 'owner', 'country', 'tags']
    search_fields = ['name', 'domain', 'industry', 'city', 'email']
    ordering_fields = ['name', 'created_at', 'annual_revenue']

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .select_related('owner')
            .prefetch_related('tags')
            .annotate(contacts_count=Count('contacts', distinct=True))
        )


class ContactViewSet(TenantViewSet):
    queryset = Contact.objects.all()
    serializer_class = ContactSerializer
    filterset_fields = ['company', 'owner', 'source', 'is_active', 'tags']
    search_fields = ['first_name', 'last_name', 'email', 'phone', 'company__name', 'job_title']
    ordering_fields = ['first_name', 'last_name', 'created_at']

    def get_queryset(self):
        return super().get_queryset().select_related('company', 'owner').prefetch_related('tags')

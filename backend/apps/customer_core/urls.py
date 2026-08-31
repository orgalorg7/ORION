from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AuditLogViewSet,
    CustomFieldDefinitionViewSet,
    ExportViewSet,
    ImportJobViewSet,
    LeadSourceViewSet,
    TeamViewSet,
)

router = DefaultRouter()
router.register('lead-sources', LeadSourceViewSet, basename='lead-source')
router.register('teams', TeamViewSet, basename='customer-team')
router.register('custom-fields', CustomFieldDefinitionViewSet, basename='custom-field')
router.register('audit-logs', AuditLogViewSet, basename='audit-log')
router.register('imports', ImportJobViewSet, basename='import')
router.register('exports', ExportViewSet, basename='export')

urlpatterns = [path('', include(router.urls))]

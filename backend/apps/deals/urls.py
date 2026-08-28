from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import DealViewSet, PipelineViewSet, StageViewSet

router = DefaultRouter()
router.register('pipelines', PipelineViewSet, basename='pipeline')
router.register('stages', StageViewSet, basename='stage')
router.register('deals', DealViewSet, basename='deal')

urlpatterns = [
    path('', include(router.urls)),
]

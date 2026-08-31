from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    DealViewSet, ForecastViewSet, LostReasonViewSet, PipelineAnalyticsViewSet,
    PipelineViewSet, ProductViewSet, StageViewSet,
)

router = DefaultRouter()
router.register('pipelines', PipelineViewSet, basename='pipeline')
router.register('stages', StageViewSet, basename='stage')
router.register('deals', DealViewSet, basename='deal')
router.register('products', ProductViewSet, basename='product')
router.register('lost-reasons', LostReasonViewSet, basename='lost-reason')
router.register('pipeline-analytics', PipelineAnalyticsViewSet, basename='pipeline-analytics')
router.register('forecasts', ForecastViewSet, basename='forecast')

urlpatterns = [
    path('', include(router.urls)),
]

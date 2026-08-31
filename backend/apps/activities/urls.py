from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ActivityOutcomeDefinitionViewSet,
    ActivityViewSet,
    BusinessHoursPolicyViewSet,
    NoteViewSet,
    RecurrenceSeriesViewSet,
)

router = DefaultRouter()
router.register('activities', ActivityViewSet, basename='activity')
router.register('notes', NoteViewSet, basename='note')
router.register('activity-outcomes', ActivityOutcomeDefinitionViewSet, basename='activity-outcome')
router.register('activity-recurrence-series', RecurrenceSeriesViewSet, basename='activity-recurrence-series')
router.register('business-hours', BusinessHoursPolicyViewSet, basename='business-hours')

urlpatterns = [
    path('', include(router.urls)),
]

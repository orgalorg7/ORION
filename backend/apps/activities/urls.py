from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ActivityViewSet, NoteViewSet

router = DefaultRouter()
router.register('activities', ActivityViewSet, basename='activity')
router.register('notes', NoteViewSet, basename='note')

urlpatterns = [
    path('', include(router.urls)),
]

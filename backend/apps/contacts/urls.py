from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CompanyViewSet, ContactViewSet, TagViewSet

router = DefaultRouter()
router.register('tags', TagViewSet, basename='tag')
router.register('companies', CompanyViewSet, basename='company')
router.register('contacts', ContactViewSet, basename='contact')

urlpatterns = [
    path('', include(router.urls)),
]

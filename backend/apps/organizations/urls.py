from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    CurrentOrganizationView,
    InvitationViewSet,
    MembershipViewSet,
    PlanListView,
    SubscriptionView,
)

router = DefaultRouter()
router.register('memberships', MembershipViewSet, basename='membership')
router.register('invitations', InvitationViewSet, basename='invitation')

urlpatterns = [
    path('organization/', CurrentOrganizationView.as_view(), name='current_organization'),
    path('plans/', PlanListView.as_view(), name='plans'),
    path('subscription/', SubscriptionView.as_view(), name='subscription'),
    path('', include(router.urls)),
]

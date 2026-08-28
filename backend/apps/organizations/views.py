from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsOrgAdmin, IsOrgMember
from apps.core.utils import get_membership

from .models import Invitation, Membership, Subscription
from .serializers import (
    InvitationSerializer,
    MembershipSerializer,
    OrganizationSerializer,
    PlanSerializer,
    SubscriptionSerializer,
)
from .services import ensure_plans
from .models import Plan


class CurrentOrganizationView(APIView):
    permission_classes = [IsAuthenticated, IsOrgMember]

    def get(self, request):
        return Response(OrganizationSerializer(get_membership(request).organization).data)

    def patch(self, request):
        membership = get_membership(request)
        if membership.role not in ('owner', 'admin'):
            return Response({'detail': 'Admin role required.'}, status=status.HTTP_403_FORBIDDEN)
        serializer = OrganizationSerializer(membership.organization, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class MembershipViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet
):
    serializer_class = MembershipSerializer
    permission_classes = [IsAuthenticated, IsOrgMember]
    filterset_fields = ['role', 'is_active']
    search_fields = ['user__email', 'user__first_name', 'user__last_name']

    def get_queryset(self):
        membership = get_membership(self.request)
        return Membership.objects.filter(organization=membership.organization).select_related('user')

    def update(self, request, *args, **kwargs):
        actor = get_membership(request)
        target = self.get_object()
        if actor.role not in ('owner', 'admin'):
            return Response({'detail': 'Admin role required.'}, status=status.HTTP_403_FORBIDDEN)
        if target.role == Membership.Role.OWNER:
            return Response({'detail': 'The owner membership cannot be modified.'}, status=status.HTTP_400_BAD_REQUEST)
        if target.pk == actor.pk:
            return Response({'detail': 'You cannot modify your own membership.'}, status=status.HTTP_400_BAD_REQUEST)
        role = request.data.get('role')
        if role is not None:
            if role not in (Membership.Role.ADMIN, Membership.Role.MANAGER, Membership.Role.MEMBER):
                return Response({'detail': 'Invalid role.'}, status=status.HTTP_400_BAD_REQUEST)
            target.role = role
        if 'is_active' in request.data:
            target.is_active = bool(request.data['is_active'])
        target.save()
        return Response(self.get_serializer(target).data)


class InvitationViewSet(
    mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet
):
    serializer_class = InvitationSerializer
    permission_classes = [IsAuthenticated, IsOrgMember, IsOrgAdmin]

    def get_queryset(self):
        membership = get_membership(self.request)
        return Invitation.objects.filter(
            organization=membership.organization, accepted_at__isnull=True
        ).select_related('invited_by')

    def create(self, request, *args, **kwargs):
        membership = get_membership(request)
        organization = membership.organization
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data['email'].lower()
        role = serializer.validated_data.get('role', Membership.Role.MEMBER)
        if role == Membership.Role.OWNER:
            return Response({'detail': 'Cannot invite as owner.'}, status=status.HTTP_400_BAD_REQUEST)

        User = get_user_model()
        existing_user = User.objects.filter(email__iexact=email).first()
        if existing_user is not None:
            _, created = Membership.objects.get_or_create(
                user=existing_user, organization=organization, defaults={'role': role}
            )
            if not created:
                return Response(
                    {'detail': 'This user is already a member of the organization.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response({'detail': 'User added to the organization.', 'added': True}, status=status.HTTP_201_CREATED)

        invitation, created = Invitation.objects.get_or_create(
            organization=organization,
            email=email,
            defaults={'role': role, 'invited_by': request.user},
        )
        if not created and invitation.accepted_at is None:
            return Response({'detail': 'An invitation for this email is already pending.'}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(invitation).data, status=status.HTTP_201_CREATED)


class PlanListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        ensure_plans()
        return Response(PlanSerializer(Plan.objects.all(), many=True).data)


class SubscriptionView(APIView):
    permission_classes = [IsAuthenticated, IsOrgMember]

    def get(self, request):
        organization = get_membership(request).organization
        subscription = getattr(organization, 'subscription', None)
        if subscription is None:
            return Response({'detail': 'No subscription found.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(SubscriptionSerializer(subscription).data)

    def post(self, request):
        """Change plan (simulated checkout — no real payment provider)."""
        membership = get_membership(request)
        if membership.role not in ('owner', 'admin'):
            return Response({'detail': 'Admin role required.'}, status=status.HTTP_403_FORBIDDEN)
        plan = Plan.objects.filter(id=request.data.get('plan_id')).first()
        if plan is None:
            return Response({'plan_id': ['Invalid plan.']}, status=status.HTTP_400_BAD_REQUEST)
        subscription, _ = Subscription.objects.get_or_create(
            organization=membership.organization, defaults={'plan': plan}
        )
        subscription.plan = plan
        subscription.status = Subscription.Status.ACTIVE
        subscription.trial_end = None
        subscription.current_period_end = timezone.now() + timedelta(days=30)
        subscription.cancel_at_period_end = False
        subscription.save()
        return Response(SubscriptionSerializer(subscription).data)

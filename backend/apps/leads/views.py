from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.contacts.models import Company, Contact
from apps.core.viewsets import TenantViewSet
from apps.deals.models import Deal, Pipeline

from .models import Lead
from .serializers import LeadConvertSerializer, LeadSerializer


class LeadViewSet(TenantViewSet):
    queryset = Lead.objects.all()
    serializer_class = LeadSerializer
    filterset_fields = ['status', 'source', 'owner']
    search_fields = ['first_name', 'last_name', 'email', 'phone', 'company_name']
    ordering_fields = ['created_at', 'score', 'estimated_value']

    def get_queryset(self):
        return super().get_queryset().select_related('owner')

    @action(detail=True, methods=['post'], url_path='convert')
    def convert(self, request, pk=None):
        lead = self.get_object()
        if lead.status == Lead.Status.CONVERTED:
            return Response({'detail': 'Lead is already converted.'}, status=status.HTTP_400_BAD_REQUEST)

        payload = LeadConvertSerializer(data=request.data, context=self.get_serializer_context())
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        org = self.org

        with transaction.atomic():
            company = None
            if lead.company_name:
                company, _ = Company.objects.get_or_create(organization=org, name=lead.company_name)

            contact = Contact.objects.create(
                organization=org,
                created_by=request.user,
                first_name=lead.first_name,
                last_name=lead.last_name,
                email=lead.email,
                phone=lead.phone,
                job_title=lead.job_title,
                source=lead.source,
                owner=lead.owner,
                description=lead.description,
                company=company,
            )

            deal = None
            if data.get('create_deal'):
                pipeline = data.get('pipeline')
                if pipeline is None:
                    pipeline = (
                        Pipeline.objects.filter(organization=org, is_default=True).first()
                        or Pipeline.objects.filter(organization=org).order_by('id').first()
                    )
                if pipeline is None:
                    return Response(
                        {'detail': 'No pipeline available to create a deal.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                stage = data.get('stage') or pipeline.stages.first()
                if stage is not None and stage.pipeline_id != pipeline.id:
                    return Response(
                        {'stage': ['Stage does not belong to the selected pipeline.']},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                deal = Deal.objects.create(
                    organization=org,
                    created_by=request.user,
                    title=data.get('deal_title') or f'{lead.full_name} deal',
                    value=data.get('deal_value') or lead.estimated_value or 0,
                    currency=org.currency,
                    pipeline=pipeline,
                    stage=stage,
                    contact=contact,
                    company=company,
                    owner=lead.owner,
                )

            lead.status = Lead.Status.CONVERTED
            lead.converted_at = timezone.now()
            lead.converted_contact = contact
            lead.converted_deal = deal
            lead.save()

        return Response(
            {
                'lead': LeadSerializer(lead, context=self.get_serializer_context()).data,
                'contact_id': contact.id,
                'company_id': company.id if company else None,
                'deal_id': deal.id if deal else None,
            }
        )

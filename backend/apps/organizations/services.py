from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from .models import Invitation, Membership, Organization, Plan, Subscription

DEFAULT_PLANS = [
    {
        'code': 'free',
        'name': 'Free',
        'name_ar': 'مجاني',
        'price_monthly': 0,
        'max_users': 3,
        'max_contacts': 500,
        'is_default': True,
        'sort_order': 0,
        'features': ['contacts', 'companies', 'leads', 'deals', 'activities'],
    },
    {
        'code': 'pro',
        'name': 'Pro',
        'name_ar': 'احترافي',
        'price_monthly': 29,
        'max_users': 25,
        'max_contacts': 25000,
        'is_default': False,
        'sort_order': 1,
        'features': ['contacts', 'companies', 'leads', 'deals', 'activities', 'tickets', 'employees', 'analytics'],
    },
    {
        'code': 'business',
        'name': 'Business',
        'name_ar': 'أعمال',
        'price_monthly': 79,
        'max_users': 100,
        'max_contacts': 100000,
        'is_default': False,
        'sort_order': 2,
        'features': [
            'contacts', 'companies', 'leads', 'deals', 'activities',
            'tickets', 'employees', 'analytics', 'priority_support', 'api_access',
        ],
    },
]

DEFAULT_STAGES = [
    {'name': 'New Lead', 'name_ar': 'فرصة جديدة', 'order': 0, 'probability': 10, 'stage_type': 'open', 'color': '#64748b'},
    {'name': 'Qualified', 'name_ar': 'مؤهل', 'order': 1, 'probability': 30, 'stage_type': 'open', 'color': '#3b82f6'},
    {'name': 'Proposal', 'name_ar': 'العرض', 'order': 2, 'probability': 60, 'stage_type': 'open', 'color': '#8b5cf6'},
    {'name': 'Negotiation', 'name_ar': 'التفاوض', 'order': 3, 'probability': 80, 'stage_type': 'open', 'color': '#f59e0b'},
    {'name': 'Won', 'name_ar': 'تم الفوز', 'order': 4, 'probability': 100, 'stage_type': 'won', 'color': '#10b981'},
    {'name': 'Lost', 'name_ar': 'تمت الخسارة', 'order': 5, 'probability': 0, 'stage_type': 'lost', 'color': '#ef4444'},
]

DEFAULT_LOST_REASONS = (
    'Price', 'Competitor', 'No Budget', 'Timing', 'No Response',
    'Requirements Changed', 'Internal Decision', 'Duplicate', 'Other',
)

DEFAULT_LEAD_SOURCES = [
    ('manual', 'Manual'),
    ('website', 'Website'),
    ('facebook', 'Facebook'),
    ('instagram', 'Instagram'),
    ('whatsapp', 'WhatsApp'),
    ('linkedin', 'LinkedIn'),
    ('google_ads', 'Google Ads'),
    ('referral', 'Referral'),
    ('import', 'Import'),
    ('api', 'API'),
    ('partner', 'Partner'),
    ('event', 'Event'),
    ('other', 'Other'),
]


def create_default_customer_configuration(organization, user=None):
    from apps.customer_core.models import LeadSource, ObjectTypeDefinition
    from apps.customer_core.scoring import seed_scoring_rules

    for order, (key, label) in enumerate(DEFAULT_LEAD_SOURCES):
        LeadSource.objects.get_or_create(
            organization=organization,
            key=key,
            defaults={
                'created_by': user,
                'updated_by': user,
                'system_key': key,
                'label': label,
                'display_order': order,
            },
        )
    for key, label in (
        ('lead', 'Lead'), ('contact', 'Contact'), ('company', 'Company'),
        ('deal', 'Deal'), ('activity', 'Activity'),
    ):
        ObjectTypeDefinition.objects.get_or_create(
            organization=organization,
            key=key,
            defaults={'created_by': user, 'updated_by': user, 'label': label, 'system': True},
        )
    seed_scoring_rules(organization, user)
    create_default_activity_configuration(organization, user)


def create_default_activity_configuration(organization, user=None):
    from datetime import time

    from apps.activities.models import ActivityOutcomeDefinition, BusinessHoursPolicy

    outcomes = {
        'call': (
            ('connected', 'Connected'), ('no_answer', 'No Answer'), ('busy', 'Busy'),
            ('voicemail', 'Voicemail'), ('wrong_number', 'Wrong Number'),
            ('rescheduled', 'Rescheduled'), ('qualified', 'Qualified'),
            ('not_interested', 'Not Interested'),
        ),
        'meeting': (
            ('successful', 'Successful'), ('rescheduled', 'Rescheduled'),
            ('no_show', 'No Show'), ('cancelled', 'Cancelled'),
            ('needs_follow_up', 'Needs Follow-up'), ('proposal_requested', 'Proposal Requested'),
        ),
    }
    for category, definitions in outcomes.items():
        for order, (key, label) in enumerate(definitions):
            ActivityOutcomeDefinition.objects.get_or_create(
                organization=organization, category=category, key=key,
                defaults={
                    'label': label, 'display_order': order,
                    'created_by': user, 'updated_by': user,
                },
            )
    BusinessHoursPolicy.objects.get_or_create(
        organization=organization, is_default=True,
        defaults={
            'name': 'Standard business hours', 'timezone': 'UTC',
            'workdays': [0, 1, 2, 3, 4], 'opens_at': time(9), 'closes_at': time(17),
            'created_by': user, 'updated_by': user,
        },
    )


def ensure_plans():
    for data in DEFAULT_PLANS:
        Plan.objects.get_or_create(code=data['code'], defaults=data)


def get_default_plan():
    ensure_plans()
    return Plan.objects.filter(is_default=True).first() or Plan.objects.order_by('sort_order').first()


def unique_org_slug(name):
    base = slugify(name, allow_unicode=False) or 'organization'
    slug = base
    counter = 2
    while Organization.objects.filter(slug=slug).exists():
        slug = f'{base}-{counter}'
        counter += 1
    return slug


def create_default_pipeline(organization, user=None):
    from apps.deals.models import LostReason, Pipeline, Stage

    language = organization.default_language
    pipeline = Pipeline.objects.create(
        organization=organization,
        created_by=user,
        name='مسار المبيعات' if language == 'ar' else 'Sales Pipeline',
        is_default=True,
    )
    for stage in DEFAULT_STAGES:
        stage_data = {key: value for key, value in stage.items() if key != 'name_ar'}
        if language == 'ar':
            stage_data['name'] = stage['name_ar']
        Stage.objects.create(
            organization=organization,
            created_by=user,
            updated_by=user,
            pipeline=pipeline,
            **stage_data,
        )
    for order, label in enumerate(DEFAULT_LOST_REASONS):
        LostReason.objects.create(
            organization=organization, created_by=user, updated_by=user, label=label, display_order=order,
        )
    return pipeline


@transaction.atomic
def register_account(*, email, password, first_name, last_name='', organization_name, language='en'):
    """Create a user with their own organization, trial subscription and default pipeline."""
    from apps.accounts.models import User

    user = User.objects.create_user(
        email=email, password=password, first_name=first_name, last_name=last_name, language=language
    )
    organization = Organization.objects.create(
        name=organization_name, slug=unique_org_slug(organization_name), default_language=language
    )
    Membership.objects.create(user=user, organization=organization, role=Membership.Role.OWNER)
    now = timezone.now()
    Subscription.objects.create(
        organization=organization,
        plan=get_default_plan(),
        status=Subscription.Status.TRIALING,
        trial_end=now + timedelta(days=14),
        current_period_end=now + timedelta(days=14),
    )
    create_default_pipeline(organization, user)
    create_default_customer_configuration(organization, user)

    # If the user was invited to other organizations before registering,
    # convert those invitations into memberships.
    for invitation in Invitation.objects.filter(email__iexact=email, accepted_at__isnull=True):
        Membership.objects.get_or_create(
            user=user, organization=invitation.organization, defaults={'role': invitation.role}
        )
        invitation.accepted_at = now
        invitation.save(update_fields=['accepted_at'])

    return user, organization

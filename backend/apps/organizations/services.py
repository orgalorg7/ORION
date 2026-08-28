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
    {'name': 'Qualification', 'name_ar': 'التأهيل', 'order': 0, 'probability': 10, 'color': '#94a3b8'},
    {'name': 'Meeting', 'name_ar': 'الاجتماع', 'order': 1, 'probability': 25, 'color': '#60a5fa'},
    {'name': 'Proposal', 'name_ar': 'العرض', 'order': 2, 'probability': 50, 'color': '#a78bfa'},
    {'name': 'Negotiation', 'name_ar': 'التفاوض', 'order': 3, 'probability': 75, 'color': '#fbbf24'},
    {'name': 'Closing', 'name_ar': 'الإغلاق', 'order': 4, 'probability': 90, 'color': '#34d399'},
]


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
    from apps.deals.models import Pipeline, Stage

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
            pipeline=pipeline,
            **stage_data,
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

    # If the user was invited to other organizations before registering,
    # convert those invitations into memberships.
    for invitation in Invitation.objects.filter(email__iexact=email, accepted_at__isnull=True):
        Membership.objects.get_or_create(
            user=user, organization=invitation.organization, defaults={'role': invitation.role}
        )
        invitation.accepted_at = now
        invitation.save(update_fields=['accepted_at'])

    return user, organization

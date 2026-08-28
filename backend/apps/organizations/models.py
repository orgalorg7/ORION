import uuid

from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel


class Plan(models.Model):
    code = models.SlugField(max_length=50, unique=True)
    name = models.CharField(max_length=100)
    name_ar = models.CharField(max_length=100, blank=True)
    price_monthly = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    max_users = models.PositiveIntegerField(default=3)
    max_contacts = models.PositiveIntegerField(default=500)
    features = models.JSONField(default=list, blank=True)
    is_default = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['sort_order', 'id']

    def __str__(self):
        return self.name


class Organization(TimeStampedModel):
    class Size(models.TextChoices):
        MICRO = '1-10', '1-10'
        SMALL = '11-50', '11-50'
        MEDIUM = '51-200', '51-200'
        LARGE = '201-1000', '201-1000'
        ENTERPRISE = '1000+', '1000+'

    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=255, unique=True)
    industry = models.CharField(max_length=100, blank=True)
    size = models.CharField(max_length=20, choices=Size.choices, blank=True)
    country = models.CharField(max_length=100, blank=True)
    website = models.URLField(blank=True)
    currency = models.CharField(max_length=10, default='USD')
    default_language = models.CharField(max_length=5, default='en')

    def __str__(self):
        return self.name


class Membership(TimeStampedModel):
    class Role(models.TextChoices):
        OWNER = 'owner', 'Owner'
        ADMIN = 'admin', 'Admin'
        MANAGER = 'manager', 'Manager'
        MEMBER = 'member', 'Member'

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='memberships')
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='memberships')
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.MEMBER)
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = [('user', 'organization')]

    def __str__(self):
        return f'{self.user} @ {self.organization} ({self.role})'


class Subscription(TimeStampedModel):
    class Status(models.TextChoices):
        TRIALING = 'trialing', 'Trialing'
        ACTIVE = 'active', 'Active'
        PAST_DUE = 'past_due', 'Past due'
        CANCELED = 'canceled', 'Canceled'

    organization = models.OneToOneField(Organization, on_delete=models.CASCADE, related_name='subscription')
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name='subscriptions')
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.TRIALING)
    trial_end = models.DateTimeField(null=True, blank=True)
    current_period_end = models.DateTimeField(null=True, blank=True)
    cancel_at_period_end = models.BooleanField(default=False)

    def __str__(self):
        return f'{self.organization} — {self.plan} ({self.status})'


class Invitation(TimeStampedModel):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='invitations')
    email = models.EmailField()
    role = models.CharField(max_length=20, choices=Membership.Role.choices, default=Membership.Role.MEMBER)
    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )
    accepted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = [('organization', 'email')]

    def __str__(self):
        return f'{self.email} → {self.organization}'

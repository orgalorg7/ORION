from django.conf import settings
from django.db import models

from apps.core.models import TenantModel
from apps.core.normalization import normalize_domain, normalize_email, normalize_name, normalize_phone
from apps.core.tenancy import validate_customer_tenant_relations


class Source(models.TextChoices):
    """Legacy API keys; tenants configure matching LeadSource records."""

    WEBSITE = 'website', 'Website'
    REFERRAL = 'referral', 'Referral'
    SOCIAL = 'social', 'Social media'
    EMAIL_CAMPAIGN = 'email_campaign', 'Email campaign'
    EVENT = 'event', 'Event'
    COLD_CALL = 'cold_call', 'Cold call'
    OTHER = 'other', 'Other'


class Tag(TenantModel):
    name = models.CharField(max_length=100)
    normalized_name = models.CharField(max_length=100, editable=False, blank=True)
    color = models.CharField(max_length=20, default='#6366f1')
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['name', 'id']
        constraints = [
            models.UniqueConstraint(fields=['organization', 'normalized_name'], name='unique_normalized_tag_per_org'),
        ]

    def save(self, *args, **kwargs):
        self.name = self.name.strip()
        self.normalized_name = normalize_name(self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Company(TenantModel):
    class Size(models.TextChoices):
        MICRO = '1-10', '1-10'
        SMALL = '11-50', '11-50'
        MEDIUM = '51-200', '51-200'
        LARGE = '201-1000', '201-1000'
        ENTERPRISE = '1000+', '1000+'

    name = models.CharField(max_length=255)
    normalized_name = models.CharField(max_length=255, editable=False, blank=True)
    legal_name = models.CharField(max_length=255, blank=True)
    domain = models.CharField(max_length=255, blank=True)
    normalized_domain = models.CharField(max_length=255, editable=False, blank=True)
    website = models.URLField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    normalized_phone = models.CharField(max_length=32, editable=False, blank=True)
    email = models.EmailField(blank=True)
    normalized_email = models.CharField(max_length=254, editable=False, blank=True)
    industry = models.CharField(max_length=100, blank=True)
    size = models.CharField(max_length=20, choices=Size.choices, blank=True)
    employee_count = models.PositiveIntegerField(null=True, blank=True)
    annual_revenue = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=10, default='USD')
    country = models.CharField(max_length=100, blank=True)
    city = models.CharField(max_length=100, blank=True)
    address = models.CharField(max_length=500, blank=True)
    lifecycle_stage = models.CharField(max_length=80, blank=True)
    source = models.CharField(max_length=80, blank=True)
    source_record = models.ForeignKey(
        'customer_core.LeadSource', null=True, blank=True, on_delete=models.SET_NULL, related_name='companies'
    )
    description = models.TextField(blank=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='owned_companies'
    )
    team = models.ForeignKey(
        'customer_core.Team', null=True, blank=True, on_delete=models.SET_NULL, related_name='companies'
    )
    archived_at = models.DateTimeField(null=True, blank=True)
    tags = models.ManyToManyField(Tag, blank=True, related_name='companies')

    class Meta:
        ordering = ['-created_at', '-id']
        verbose_name_plural = 'companies'
        indexes = [
            models.Index(fields=['organization', 'normalized_name']),
            models.Index(fields=['organization', 'normalized_domain']),
            models.Index(fields=['organization', 'normalized_phone']),
            models.Index(fields=['organization', 'owner', 'archived_at']),
            models.Index(fields=['organization', 'lifecycle_stage', 'created_at']),
            models.Index(fields=['organization', 'country', 'city']),
        ]

    @property
    def primary_phone(self):
        return self.phone

    def save(self, *args, **kwargs):
        self.name = self.name.strip()
        self.normalized_name = normalize_name(self.name)
        self.normalized_domain = normalize_domain(self.domain or self.website)
        self.normalized_email = normalize_email(self.email)
        self.normalized_phone = normalize_phone(self.phone, self.country)
        validate_customer_tenant_relations(self)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Contact(TenantModel):
    first_name = models.CharField(max_length=150)
    last_name = models.CharField(max_length=150, blank=True)
    display_name = models.CharField(max_length=310, blank=True)
    normalized_name = models.CharField(max_length=310, editable=False, blank=True)
    email = models.EmailField(blank=True)
    normalized_email = models.CharField(max_length=254, editable=False, blank=True)
    phone = models.CharField(max_length=50, blank=True)
    normalized_phone = models.CharField(max_length=32, editable=False, blank=True)
    secondary_phone = models.CharField(max_length=50, blank=True)
    job_title = models.CharField(max_length=150, blank=True)
    department = models.CharField(max_length=150, blank=True)
    company = models.ForeignKey(Company, null=True, blank=True, on_delete=models.SET_NULL, related_name='contacts')
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='owned_contacts'
    )
    team = models.ForeignKey(
        'customer_core.Team', null=True, blank=True, on_delete=models.SET_NULL, related_name='contacts'
    )
    source = models.CharField(max_length=80, blank=True)
    source_record = models.ForeignKey(
        'customer_core.LeadSource', null=True, blank=True, on_delete=models.SET_NULL, related_name='contacts'
    )
    lifecycle_stage = models.CharField(max_length=80, blank=True)
    preferred_channel = models.CharField(max_length=40, blank=True)
    language = models.CharField(max_length=12, blank=True)
    timezone = models.CharField(max_length=80, blank=True)
    address = models.CharField(max_length=500, blank=True)
    city = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=100, blank=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    tags = models.ManyToManyField(Tag, blank=True, related_name='contacts')

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [
            models.Index(fields=['organization', 'normalized_email']),
            models.Index(fields=['organization', 'normalized_phone']),
            models.Index(fields=['organization', 'normalized_name']),
            models.Index(fields=['organization', 'company', 'archived_at']),
            models.Index(fields=['organization', 'owner', 'archived_at']),
            models.Index(fields=['organization', 'lifecycle_stage', 'created_at']),
        ]

    def save(self, *args, **kwargs):
        self.first_name = self.first_name.strip()
        self.last_name = self.last_name.strip()
        self.display_name = self.display_name.strip() or self.full_name
        self.normalized_name = normalize_name(self.display_name)
        self.normalized_email = normalize_email(self.email)
        self.normalized_phone = normalize_phone(self.phone, self.country)
        validate_customer_tenant_relations(self)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.display_name or self.full_name

    @property
    def full_name(self):
        return f'{self.first_name} {self.last_name}'.strip()

    @property
    def primary_email(self):
        return self.email

    @property
    def primary_phone(self):
        return self.phone

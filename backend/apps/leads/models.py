from django.conf import settings
from django.core.validators import MaxValueValidator
from django.db import models

from apps.core.models import TenantModel
from apps.core.normalization import normalize_email, normalize_name, normalize_phone
from apps.core.tenancy import validate_customer_tenant_relations


class Lead(TenantModel):
    class Status(models.TextChoices):
        NEW = 'new', 'New'
        CONTACTED = 'contacted', 'Contacted'
        QUALIFIED = 'qualified', 'Qualified'
        UNQUALIFIED = 'unqualified', 'Unqualified'
        CONVERTED = 'converted', 'Converted'

    class Temperature(models.TextChoices):
        COLD = 'cold', 'Cold'
        WARM = 'warm', 'Warm'
        HOT = 'hot', 'Hot'

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
    company_name = models.CharField(max_length=255, blank=True)
    company = models.ForeignKey(
        'contacts.Company', null=True, blank=True, on_delete=models.SET_NULL, related_name='leads'
    )
    estimated_value = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=10, default='USD')
    score = models.PositiveIntegerField(default=0, validators=[MaxValueValidator(1000)])
    score_breakdown = models.JSONField(default=list, blank=True)
    temperature = models.CharField(max_length=12, choices=Temperature.choices, blank=True)
    source = models.CharField(max_length=80, blank=True)
    source_record = models.ForeignKey(
        'customer_core.LeadSource', null=True, blank=True, on_delete=models.SET_NULL, related_name='leads'
    )
    lifecycle_stage = models.CharField(max_length=80, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.NEW)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='owned_leads'
    )
    team = models.ForeignKey(
        'customer_core.Team', null=True, blank=True, on_delete=models.SET_NULL, related_name='leads'
    )
    country = models.CharField(max_length=100, blank=True)
    city = models.CharField(max_length=100, blank=True)
    address = models.CharField(max_length=500, blank=True)
    timezone = models.CharField(max_length=80, blank=True)
    language = models.CharField(max_length=12, blank=True)
    preferred_channel = models.CharField(max_length=40, blank=True)
    description = models.TextField(blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    converted_at = models.DateTimeField(null=True, blank=True)
    converted_contact = models.ForeignKey(
        'contacts.Contact', null=True, blank=True, on_delete=models.SET_NULL, related_name='converted_from_leads'
    )
    converted_company = models.ForeignKey(
        'contacts.Company', null=True, blank=True, on_delete=models.SET_NULL, related_name='converted_from_leads'
    )
    converted_deal = models.ForeignKey(
        'deals.Deal', null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )
    utm_source = models.CharField(max_length=160, blank=True)
    utm_medium = models.CharField(max_length=160, blank=True)
    utm_campaign = models.CharField(max_length=160, blank=True)
    utm_term = models.CharField(max_length=160, blank=True)
    utm_content = models.CharField(max_length=160, blank=True)
    tags = models.ManyToManyField('contacts.Tag', blank=True, related_name='leads')

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [
            models.Index(fields=['organization', 'normalized_email']),
            models.Index(fields=['organization', 'normalized_phone']),
            models.Index(fields=['organization', 'normalized_name']),
            models.Index(fields=['organization', 'owner', 'archived_at']),
            models.Index(fields=['organization', 'team', 'archived_at']),
            models.Index(fields=['organization', 'status', 'created_at']),
            models.Index(fields=['organization', 'lifecycle_stage', 'created_at']),
            models.Index(fields=['organization', 'source', 'created_at']),
            models.Index(fields=['organization', 'score']),
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

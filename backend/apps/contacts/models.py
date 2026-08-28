from django.conf import settings
from django.db import models

from apps.core.models import TenantModel


class Source(models.TextChoices):
    WEBSITE = 'website', 'Website'
    REFERRAL = 'referral', 'Referral'
    SOCIAL = 'social', 'Social media'
    EMAIL_CAMPAIGN = 'email_campaign', 'Email campaign'
    EVENT = 'event', 'Event'
    COLD_CALL = 'cold_call', 'Cold call'
    OTHER = 'other', 'Other'


class Tag(TenantModel):
    name = models.CharField(max_length=100)
    color = models.CharField(max_length=20, default='#6366f1')

    class Meta:
        unique_together = [('organization', 'name')]
        ordering = ['name']

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
    domain = models.CharField(max_length=255, blank=True)
    industry = models.CharField(max_length=100, blank=True)
    size = models.CharField(max_length=20, choices=Size.choices, blank=True)
    website = models.URLField(blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    address = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=100, blank=True)
    annual_revenue = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    description = models.TextField(blank=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='owned_companies'
    )
    tags = models.ManyToManyField(Tag, blank=True, related_name='companies')

    class Meta:
        ordering = ['-created_at']
        verbose_name_plural = 'companies'

    def __str__(self):
        return self.name


class Contact(TenantModel):
    first_name = models.CharField(max_length=150)
    last_name = models.CharField(max_length=150, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    job_title = models.CharField(max_length=150, blank=True)
    company = models.ForeignKey(Company, null=True, blank=True, on_delete=models.SET_NULL, related_name='contacts')
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='owned_contacts'
    )
    source = models.CharField(max_length=30, choices=Source.choices, blank=True)
    address = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=100, blank=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    tags = models.ManyToManyField(Tag, blank=True, related_name='contacts')

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.first_name} {self.last_name}'.strip()

    @property
    def full_name(self):
        return f'{self.first_name} {self.last_name}'.strip()

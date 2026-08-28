from django.conf import settings
from django.core.validators import MaxValueValidator
from django.db import models

from apps.contacts.models import Source
from apps.core.models import TenantModel


class Lead(TenantModel):
    class Status(models.TextChoices):
        NEW = 'new', 'New'
        CONTACTED = 'contacted', 'Contacted'
        QUALIFIED = 'qualified', 'Qualified'
        UNQUALIFIED = 'unqualified', 'Unqualified'
        CONVERTED = 'converted', 'Converted'

    first_name = models.CharField(max_length=150)
    last_name = models.CharField(max_length=150, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    company_name = models.CharField(max_length=255, blank=True)
    job_title = models.CharField(max_length=150, blank=True)
    source = models.CharField(max_length=30, choices=Source.choices, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.NEW)
    score = models.PositiveIntegerField(default=0, validators=[MaxValueValidator(100)])
    estimated_value = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='owned_leads'
    )
    description = models.TextField(blank=True)
    converted_at = models.DateTimeField(null=True, blank=True)
    converted_contact = models.ForeignKey(
        'contacts.Contact', null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )
    converted_deal = models.ForeignKey(
        'deals.Deal', null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.first_name} {self.last_name}'.strip()

    @property
    def full_name(self):
        return f'{self.first_name} {self.last_name}'.strip()

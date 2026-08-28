from django.conf import settings
from django.db import models

from apps.core.models import TenantModel


class Pipeline(TenantModel):
    name = models.CharField(max_length=150)
    is_default = models.BooleanField(default=False)

    class Meta:
        ordering = ['id']

    def __str__(self):
        return self.name


class Stage(TenantModel):
    pipeline = models.ForeignKey(Pipeline, on_delete=models.CASCADE, related_name='stages')
    name = models.CharField(max_length=150)
    order = models.PositiveIntegerField(default=0)
    probability = models.PositiveIntegerField(default=0)
    color = models.CharField(max_length=20, default='#94a3b8')

    class Meta:
        ordering = ['order', 'id']

    def __str__(self):
        return f'{self.pipeline.name} / {self.name}'


class Deal(TenantModel):
    class Status(models.TextChoices):
        OPEN = 'open', 'Open'
        WON = 'won', 'Won'
        LOST = 'lost', 'Lost'

    title = models.CharField(max_length=255)
    value = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    currency = models.CharField(max_length=10, default='USD')
    pipeline = models.ForeignKey(Pipeline, on_delete=models.CASCADE, related_name='deals')
    stage = models.ForeignKey(Stage, null=True, blank=True, on_delete=models.SET_NULL, related_name='deals')
    contact = models.ForeignKey(
        'contacts.Contact', null=True, blank=True, on_delete=models.SET_NULL, related_name='deals'
    )
    company = models.ForeignKey(
        'contacts.Company', null=True, blank=True, on_delete=models.SET_NULL, related_name='deals'
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='owned_deals'
    )
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    expected_close_date = models.DateField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    lost_reason = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
    tags = models.ManyToManyField('contacts.Tag', blank=True, related_name='deals')

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title

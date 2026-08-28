from django.conf import settings
from django.db import models

from apps.core.models import TenantModel


class Activity(TenantModel):
    class Type(models.TextChoices):
        CALL = 'call', 'Call'
        EMAIL = 'email', 'Email'
        MEETING = 'meeting', 'Meeting'
        TASK = 'task', 'Task'

    type = models.CharField(max_length=20, choices=Type.choices, default=Type.TASK)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    due_at = models.DateTimeField(null=True, blank=True)
    completed = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='assigned_activities'
    )
    contact = models.ForeignKey(
        'contacts.Contact', null=True, blank=True, on_delete=models.CASCADE, related_name='activities'
    )
    company = models.ForeignKey(
        'contacts.Company', null=True, blank=True, on_delete=models.CASCADE, related_name='activities'
    )
    deal = models.ForeignKey(
        'deals.Deal', null=True, blank=True, on_delete=models.CASCADE, related_name='activities'
    )
    lead = models.ForeignKey(
        'leads.Lead', null=True, blank=True, on_delete=models.CASCADE, related_name='activities'
    )

    class Meta:
        ordering = ['completed', 'due_at', '-created_at']
        verbose_name_plural = 'activities'

    def __str__(self):
        return self.title


class Note(TenantModel):
    body = models.TextField()
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='notes'
    )
    contact = models.ForeignKey(
        'contacts.Contact', null=True, blank=True, on_delete=models.CASCADE, related_name='notes'
    )
    company = models.ForeignKey(
        'contacts.Company', null=True, blank=True, on_delete=models.CASCADE, related_name='notes'
    )
    deal = models.ForeignKey(
        'deals.Deal', null=True, blank=True, on_delete=models.CASCADE, related_name='notes'
    )
    lead = models.ForeignKey(
        'leads.Lead', null=True, blank=True, on_delete=models.CASCADE, related_name='notes'
    )

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.body[:50]

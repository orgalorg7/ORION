from django.conf import settings
from django.db import models
from django.db.models import Max

from apps.core.models import TenantModel, TimeStampedModel


class Ticket(TenantModel):
    class Status(models.TextChoices):
        OPEN = 'open', 'Open'
        IN_PROGRESS = 'in_progress', 'In progress'
        RESOLVED = 'resolved', 'Resolved'
        CLOSED = 'closed', 'Closed'

    class Priority(models.TextChoices):
        LOW = 'low', 'Low'
        MEDIUM = 'medium', 'Medium'
        HIGH = 'high', 'High'
        URGENT = 'urgent', 'Urgent'

    class Category(models.TextChoices):
        GENERAL = 'general', 'General'
        BILLING = 'billing', 'Billing'
        TECHNICAL = 'technical', 'Technical'
        FEATURE_REQUEST = 'feature_request', 'Feature request'

    number = models.PositiveIntegerField(editable=False, null=True)
    subject = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    contact = models.ForeignKey(
        'contacts.Contact', null=True, blank=True, on_delete=models.SET_NULL, related_name='tickets'
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.MEDIUM)
    category = models.CharField(max_length=30, choices=Category.choices, default=Category.GENERAL)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='assigned_tickets'
    )

    class Meta:
        ordering = ['-created_at']
        unique_together = [('organization', 'number')]

    def save(self, *args, **kwargs):
        if self.number is None and self.organization_id:
            last = Ticket.objects.filter(organization_id=self.organization_id).aggregate(m=Max('number'))['m'] or 0
            self.number = last + 1
        super().save(*args, **kwargs)

    def __str__(self):
        return f'#{self.number} {self.subject}'


class TicketComment(TimeStampedModel):
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name='comments')
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='ticket_comments'
    )
    body = models.TextField()
    is_internal = models.BooleanField(default=False)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f'Comment on {self.ticket}'

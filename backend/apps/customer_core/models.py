from django.conf import settings
from django.db import models
from apps.core.models import TenantModel
from apps.core.normalization import normalize_name


class CustomerObject(models.TextChoices):
    LEAD = 'lead', 'Lead'
    CONTACT = 'contact', 'Contact'
    COMPANY = 'company', 'Company'
    DEAL = 'deal', 'Deal'
    ACTIVITY = 'activity', 'Activity'


class ObjectTypeDefinition(TenantModel):
    key = models.SlugField(max_length=80)
    label = models.CharField(max_length=160)
    system = models.BooleanField(default=False)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ['system', 'label', 'id']
        constraints = [models.UniqueConstraint(fields=['organization', 'key'], name='unique_object_type_per_org')]


class Team(TenantModel):
    name = models.CharField(max_length=120)
    normalized_name = models.CharField(max_length=120, editable=False)
    active = models.BooleanField(default=True)
    members = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name='customer_teams')

    class Meta:
        ordering = ['name', 'id']
        constraints = [
            models.UniqueConstraint(fields=['organization', 'normalized_name'], name='unique_normalized_team_per_org'),
        ]

    def save(self, *args, **kwargs):
        self.name = self.name.strip()
        self.normalized_name = normalize_name(self.name)
        super().save(*args, **kwargs)


class LeadSource(TenantModel):
    key = models.SlugField(max_length=80)
    system_key = models.SlugField(max_length=80, blank=True)
    label = models.CharField(max_length=120)
    active = models.BooleanField(default=True)
    display_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['display_order', 'label', 'id']
        constraints = [
            models.UniqueConstraint(fields=['organization', 'key'], name='unique_source_key_per_org'),
        ]


class CustomFieldDefinition(TenantModel):
    class DataType(models.TextChoices):
        TEXT = 'text', 'Text'
        TEXTAREA = 'textarea', 'Textarea'
        INTEGER = 'integer', 'Integer'
        DECIMAL = 'decimal', 'Decimal'
        CURRENCY = 'currency', 'Currency'
        BOOLEAN = 'boolean', 'Boolean'
        DATE = 'date', 'Date'
        DATETIME = 'datetime', 'Datetime'
        EMAIL = 'email', 'Email'
        PHONE = 'phone', 'Phone'
        URL = 'url', 'URL'
        SELECT = 'select', 'Select'
        MULTI_SELECT = 'multi_select', 'Multi-select'

    target_object = models.CharField(max_length=80)
    key = models.SlugField(max_length=80)
    label = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    data_type = models.CharField(max_length=32, choices=DataType.choices)
    required = models.BooleanField(default=False)
    unique = models.BooleanField(default=False)
    default_value = models.JSONField(null=True, blank=True)
    options = models.JSONField(default=list, blank=True)
    validation_rules = models.JSONField(default=dict, blank=True)
    display_order = models.PositiveIntegerField(default=0)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ['display_order', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['organization', 'target_object', 'key'], name='unique_custom_field_key_per_object'
            ),
        ]
        indexes = [models.Index(fields=['organization', 'target_object', 'active', 'display_order'])]


class CustomFieldValue(TenantModel):
    definition = models.ForeignKey(CustomFieldDefinition, on_delete=models.CASCADE, related_name='values')
    target_object = models.CharField(max_length=80)
    object_id = models.PositiveBigIntegerField()
    text_value = models.TextField(null=True, blank=True)
    number_value = models.DecimalField(max_digits=24, decimal_places=6, null=True, blank=True)
    boolean_value = models.BooleanField(null=True, blank=True)
    date_value = models.DateField(null=True, blank=True)
    datetime_value = models.DateTimeField(null=True, blank=True)
    json_value = models.JSONField(null=True, blank=True)
    normalized_value = models.CharField(max_length=500, blank=True)
    unique_value = models.CharField(max_length=500, null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['definition', 'object_id'], name='unique_custom_value_per_object'),
            models.UniqueConstraint(fields=['definition', 'unique_value'], name='unique_custom_field_value'),
        ]
        indexes = [
            models.Index(fields=['organization', 'target_object', 'object_id']),
            models.Index(fields=['definition', 'normalized_value']),
            models.Index(fields=['definition', 'number_value']),
            models.Index(fields=['definition', 'date_value']),
            models.Index(fields=['definition', 'datetime_value']),
            models.Index(fields=['definition', 'boolean_value']),
        ]


class DomainEvent(TenantModel):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    object_type = models.CharField(max_length=64)
    object_id = models.PositiveBigIntegerField()
    event_type = models.CharField(max_length=100)
    metadata = models.JSONField(default=dict, blank=True)
    field_diff = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [
            models.Index(fields=['organization', 'object_type', 'object_id', '-created_at']),
            models.Index(fields=['organization', 'event_type', '-created_at']),
        ]


class AuditLog(TenantModel):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    action = models.CharField(max_length=100)
    entity_type = models.CharField(max_length=64)
    entity_id = models.PositiveBigIntegerField()
    diff = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [models.Index(fields=['organization', 'entity_type', 'entity_id', '-created_at'])]


class LeadScoringRule(TenantModel):
    code = models.SlugField(max_length=80)
    label = models.CharField(max_length=160)
    condition = models.JSONField(default=dict)
    points = models.SmallIntegerField()
    active = models.BooleanField(default=True)
    display_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['display_order', 'id']
        constraints = [models.UniqueConstraint(fields=['organization', 'code'], name='unique_score_rule_per_org')]


class ImportJob(TenantModel):
    class Status(models.TextChoices):
        UPLOADED = 'uploaded', 'Uploaded'
        VALIDATED = 'validated', 'Validated'
        PROCESSING = 'processing', 'Processing'
        COMPLETED = 'completed', 'Completed'
        FAILED = 'failed', 'Failed'

    target_object = models.CharField(max_length=32, choices=CustomerObject.choices)
    source_file = models.FileField(upload_to='customer-imports/%Y/%m/%d')
    original_filename = models.CharField(max_length=255)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.UPLOADED)
    detected_columns = models.JSONField(default=list)
    preview_rows = models.JSONField(default=list)
    mapping = models.JSONField(default=dict)
    report = models.JSONField(default=dict)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [models.Index(fields=['organization', '-created_at'])]


class ObjectRelationship(TenantModel):
    source_type = models.CharField(max_length=80)
    source_id = models.PositiveBigIntegerField()
    target_type = models.CharField(max_length=80)
    target_id = models.PositiveBigIntegerField()
    relationship_type = models.SlugField(max_length=80)
    metadata = models.JSONField(default=dict, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['organization', 'source_type', 'source_id', 'target_type', 'target_id', 'relationship_type'],
                name='unique_object_relationship',
            ),
        ]
        indexes = [
            models.Index(fields=['organization', 'source_type', 'source_id', 'archived_at']),
            models.Index(fields=['organization', 'target_type', 'target_id', 'archived_at']),
        ]


class MergeOperation(TenantModel):
    class Status(models.TextChoices):
        PLANNED = 'planned', 'Planned'
        COMPLETED = 'completed', 'Completed'
        FAILED = 'failed', 'Failed'

    object_type = models.CharField(max_length=80)
    survivor_id = models.PositiveBigIntegerField()
    merged_ids = models.JSONField(default=list)
    conflict_resolution = models.JSONField(default=dict)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PLANNED)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [models.Index(fields=['organization', 'object_type', 'survivor_id'])]

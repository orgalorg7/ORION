from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models
from django.db.models import Q
from django.utils import timezone
from django.utils.text import slugify

from apps.core.models import TenantModel
from apps.core.normalization import normalize_name
from apps.core.tenancy import validate_customer_tenant_relations


currency_validator = RegexValidator(r'^[A-Z]{3}$', 'Use a three-letter ISO currency code.')
money_min = MinValueValidator(Decimal('0'))


class Pipeline(TenantModel):
    name = models.CharField(max_length=150)
    key = models.SlugField(max_length=100)
    description = models.TextField(blank=True)
    is_default = models.BooleanField(default=False)
    active = models.BooleanField(default=True)
    display_order = models.PositiveIntegerField(default=0)
    require_lost_reason = models.BooleanField(default=True)
    stale_activity_days = models.PositiveSmallIntegerField(default=14)
    stale_stage_days = models.PositiveSmallIntegerField(default=21)
    version = models.PositiveIntegerField(default=1)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['display_order', 'id']
        constraints = [
            models.UniqueConstraint(fields=['organization', 'key'], name='unique_pipeline_key_per_org'),
            models.UniqueConstraint(
                fields=['organization'],
                condition=Q(is_default=True, active=True, archived_at__isnull=True),
                name='one_active_default_pipeline_per_org',
            ),
        ]
        indexes = [models.Index(fields=['organization', 'active', 'archived_at', 'display_order'])]

    def save(self, *args, **kwargs):
        self.name = self.name.strip()
        if not self.key:
            self.key = slugify(self.name)[:100] or f'pipeline-{self.pk or "new"}'
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Stage(TenantModel):
    class Type(models.TextChoices):
        OPEN = 'open', 'Open'
        WON = 'won', 'Won'
        LOST = 'lost', 'Lost'
        ON_HOLD = 'on_hold', 'On hold'

    pipeline = models.ForeignKey(Pipeline, on_delete=models.PROTECT, related_name='stages')
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0)
    probability = models.PositiveSmallIntegerField(
        default=0, validators=[MinValueValidator(0), MaxValueValidator(100)]
    )
    stage_type = models.CharField(max_length=16, choices=Type.choices, default=Type.OPEN)
    color = models.CharField(max_length=20, default='#64748b')
    active = models.BooleanField(default=True)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['order', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['pipeline', 'order'], condition=Q(archived_at__isnull=True), name='unique_active_stage_order'
            ),
            models.UniqueConstraint(
                fields=['pipeline', 'stage_type'],
                condition=Q(stage_type__in=['won', 'lost'], active=True, archived_at__isnull=True),
                name='one_active_terminal_stage_type_per_pipeline',
            ),
        ]
        indexes = [models.Index(fields=['organization', 'pipeline', 'active', 'order'])]

    def save(self, *args, **kwargs):
        self.name = self.name.strip()
        if self.pipeline_id and self.organization_id and self.pipeline.organization_id != self.organization_id:
            raise ValidationError({'pipeline': 'Pipeline must belong to the same tenant.'})
        if self.stage_type == self.Type.WON:
            self.probability = 100
        elif self.stage_type == self.Type.LOST:
            self.probability = 0
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.pipeline.name} / {self.name}'


class LostReason(TenantModel):
    label = models.CharField(max_length=160)
    normalized_label = models.CharField(max_length=160, editable=False)
    active = models.BooleanField(default=True)
    display_order = models.PositiveIntegerField(default=0)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['display_order', 'id']
        constraints = [
            models.UniqueConstraint(fields=['organization', 'normalized_label'], name='unique_lost_reason_per_org')
        ]

    def save(self, *args, **kwargs):
        self.label = self.label.strip()
        self.normalized_label = normalize_name(self.label)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.label


class Product(TenantModel):
    name = models.CharField(max_length=255)
    sku = models.CharField(max_length=100, blank=True)
    description = models.TextField(blank=True)
    active = models.BooleanField(default=True)
    default_price = models.DecimalField(max_digits=18, decimal_places=2, default=0, validators=[money_min])
    currency = models.CharField(max_length=3, default='USD', validators=[currency_validator])
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['name', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['organization', 'sku'], condition=~Q(sku=''), name='unique_product_sku_per_org'
            )
        ]
        indexes = [models.Index(fields=['organization', 'active', 'name'])]

    def save(self, *args, **kwargs):
        self.name = self.name.strip()
        self.sku = self.sku.strip()
        self.currency = self.currency.upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class PriceBook(TenantModel):
    name = models.CharField(max_length=160)
    currency = models.CharField(max_length=3, validators=[currency_validator])
    active = models.BooleanField(default=True)
    is_default = models.BooleanField(default=False)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['name', 'id']
        constraints = [
            models.UniqueConstraint(fields=['organization', 'name', 'currency'], name='unique_price_book_per_org'),
            models.UniqueConstraint(
                fields=['organization', 'currency'],
                condition=Q(is_default=True, active=True, archived_at__isnull=True),
                name='one_default_price_book_per_currency',
            ),
        ]


class PriceBookEntry(TenantModel):
    price_book = models.ForeignKey(PriceBook, on_delete=models.PROTECT, related_name='entries')
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name='price_book_entries')
    unit_price = models.DecimalField(max_digits=18, decimal_places=2, validators=[money_min])

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['price_book', 'product'], name='unique_product_price_book_entry')
        ]

    def save(self, *args, **kwargs):
        if self.price_book_id and self.price_book.organization_id != self.organization_id:
            raise ValidationError({'price_book': 'Price book must belong to the same tenant.'})
        if self.product_id and self.product.organization_id != self.organization_id:
            raise ValidationError({'product': 'Product must belong to the same tenant.'})
        super().save(*args, **kwargs)


class Deal(TenantModel):
    class Status(models.TextChoices):
        OPEN = 'open', 'Open'
        WON = 'won', 'Won'
        LOST = 'lost', 'Lost'
        ABANDONED = 'abandoned', 'Abandoned'

    class Priority(models.TextChoices):
        LOW = 'low', 'Low'
        MEDIUM = 'medium', 'Medium'
        HIGH = 'high', 'High'
        CRITICAL = 'critical', 'Critical'

    class ForecastCategory(models.TextChoices):
        PIPELINE = 'pipeline', 'Pipeline'
        BEST_CASE = 'best_case', 'Best case'
        COMMIT = 'commit', 'Commit'
        CLOSED = 'closed', 'Closed'

    class ValueMode(models.TextChoices):
        MANUAL = 'manual', 'Manual'
        LINE_ITEMS = 'line_items', 'Calculated from line items'

    title = models.CharField(max_length=255)
    normalized_title = models.CharField(max_length=255, editable=False, blank=True)
    description = models.TextField(blank=True)
    value = models.DecimalField(max_digits=18, decimal_places=2, default=0, validators=[money_min])
    value_mode = models.CharField(max_length=16, choices=ValueMode.choices, default=ValueMode.MANUAL)
    currency = models.CharField(max_length=3, default='USD', validators=[currency_validator])
    probability_override = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(0), MaxValueValidator(100)]
    )
    pipeline = models.ForeignKey(Pipeline, on_delete=models.PROTECT, related_name='deals')
    stage = models.ForeignKey(Stage, on_delete=models.PROTECT, related_name='deals')
    contact = models.ForeignKey(
        'contacts.Contact', null=True, blank=True, on_delete=models.SET_NULL, related_name='deals'
    )
    company = models.ForeignKey(
        'contacts.Company', null=True, blank=True, on_delete=models.SET_NULL, related_name='deals'
    )
    source_lead = models.ForeignKey(
        'leads.Lead', null=True, blank=True, on_delete=models.SET_NULL, related_name='source_deals'
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='owned_deals'
    )
    team = models.ForeignKey(
        'customer_core.Team', null=True, blank=True, on_delete=models.SET_NULL, related_name='deals'
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.OPEN)
    priority = models.CharField(max_length=16, choices=Priority.choices, default=Priority.MEDIUM)
    source = models.CharField(max_length=80, blank=True)
    deal_type = models.CharField(max_length=80, blank=True)
    forecast_category = models.CharField(
        max_length=16, choices=ForecastCategory.choices, default=ForecastCategory.PIPELINE
    )
    expected_close_date = models.DateField(null=True, blank=True)
    actual_close_date = models.DateField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    won_at = models.DateTimeField(null=True, blank=True)
    lost_at = models.DateTimeField(null=True, blank=True)
    abandoned_at = models.DateTimeField(null=True, blank=True)
    reopened_at = models.DateTimeField(null=True, blank=True)
    lost_reason = models.CharField(max_length=255, blank=True)
    lost_reason_record = models.ForeignKey(
        LostReason, null=True, blank=True, on_delete=models.PROTECT, related_name='deals'
    )
    lost_reason_text = models.TextField(blank=True)
    stage_entered_at = models.DateTimeField(default=timezone.now)
    version = models.PositiveIntegerField(default=1)
    archived_at = models.DateTimeField(null=True, blank=True)
    tags = models.ManyToManyField('contacts.Tag', blank=True, related_name='deals')

    class Meta:
        ordering = ['-created_at', '-id']
        constraints = [
            models.CheckConstraint(condition=Q(value__gte=0), name='deal_value_non_negative'),
            models.CheckConstraint(
                condition=Q(probability_override__isnull=True) |
                Q(probability_override__gte=0, probability_override__lte=100),
                name='deal_probability_valid',
            ),
        ]
        indexes = [
            models.Index(fields=['organization', 'pipeline', 'stage', 'status', 'archived_at']),
            models.Index(fields=['organization', 'owner', 'status', 'archived_at']),
            models.Index(fields=['organization', 'team', 'status', 'archived_at']),
            models.Index(fields=['organization', 'company', 'archived_at']),
            models.Index(fields=['organization', 'expected_close_date', 'status']),
            models.Index(fields=['organization', 'created_at']),
            models.Index(fields=['organization', 'normalized_title']),
        ]

    def save(self, *args, **kwargs):
        self.title = self.title.strip()
        self.normalized_title = normalize_name(self.title)
        self.currency = self.currency.upper()
        if not self.stage_id and self.pipeline_id:
            desired_type = {
                self.Status.WON: Stage.Type.WON,
                self.Status.LOST: Stage.Type.LOST,
            }.get(self.status)
            candidates = self.pipeline.stages.filter(active=True, archived_at__isnull=True)
            if desired_type:
                candidates = candidates.filter(stage_type=desired_type)
            else:
                candidates = candidates.filter(stage_type__in=(Stage.Type.OPEN, Stage.Type.ON_HOLD))
            self.stage = candidates.order_by('order', 'id').first()
            if self.stage is None:
                raise ValidationError({'stage': 'Pipeline has no compatible active stage.'})
        validate_customer_tenant_relations(self)
        for field in ('pipeline', 'stage', 'source_lead', 'lost_reason_record'):
            related_id = getattr(self, f'{field}_id', None)
            if related_id and getattr(self, field).organization_id != self.organization_id:
                raise ValidationError({field: 'Related record must belong to the same tenant.'})
        if self.stage_id and self.pipeline_id and self.stage.pipeline_id != self.pipeline_id:
            raise ValidationError({'stage': 'Stage must belong to the selected pipeline.'})
        super().save(*args, **kwargs)

    @property
    def effective_probability(self):
        if self.status == self.Status.WON or self.stage.stage_type == Stage.Type.WON:
            return 100
        if self.status in (self.Status.LOST, self.Status.ABANDONED) or self.stage.stage_type == Stage.Type.LOST:
            return 0
        return self.probability_override if self.probability_override is not None else self.stage.probability

    @property
    def weighted_value(self):
        return (self.value * Decimal(self.effective_probability) / Decimal('100')).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP
        )

    def __str__(self):
        return self.title


class DealContact(TenantModel):
    class Role(models.TextChoices):
        PRIMARY = 'primary', 'Primary contact'
        DECISION_MAKER = 'decision_maker', 'Decision maker'
        CHAMPION = 'champion', 'Champion'
        INFLUENCER = 'influencer', 'Influencer'
        BILLING = 'billing', 'Billing contact'
        TECHNICAL = 'technical', 'Technical contact'
        OTHER = 'other', 'Other'

    deal = models.ForeignKey(Deal, on_delete=models.CASCADE, related_name='participants')
    contact = models.ForeignKey('contacts.Contact', on_delete=models.PROTECT, related_name='deal_roles')
    role = models.CharField(max_length=24, choices=Role.choices, default=Role.OTHER)
    is_primary = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['deal', 'contact', 'role'], name='unique_deal_contact_role'),
            models.UniqueConstraint(fields=['deal'], condition=Q(is_primary=True), name='one_primary_participant_per_deal'),
        ]
        indexes = [models.Index(fields=['organization', 'deal', 'role'])]

    def save(self, *args, **kwargs):
        if self.deal_id and self.deal.organization_id != self.organization_id:
            raise ValidationError({'deal': 'Deal must belong to the same tenant.'})
        if self.contact_id and self.contact.organization_id != self.organization_id:
            raise ValidationError({'contact': 'Contact must belong to the same tenant.'})
        super().save(*args, **kwargs)


class DealStageHistory(TenantModel):
    deal = models.ForeignKey(Deal, on_delete=models.CASCADE, related_name='stage_history')
    pipeline = models.ForeignKey(Pipeline, on_delete=models.PROTECT, related_name='+')
    from_stage = models.ForeignKey(Stage, null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    to_stage = models.ForeignKey(Stage, on_delete=models.PROTECT, related_name='+')
    entered_at = models.DateTimeField(default=timezone.now)
    exited_at = models.DateTimeField(null=True, blank=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='+')

    class Meta:
        ordering = ['entered_at', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['deal'], condition=Q(exited_at__isnull=True), name='one_current_stage_history_per_deal'
            )
        ]
        indexes = [
            models.Index(fields=['organization', 'deal', 'entered_at']),
            models.Index(fields=['organization', 'pipeline', 'to_stage', 'entered_at']),
        ]

    def save(self, *args, **kwargs):
        relations = ('deal', 'pipeline', 'from_stage', 'to_stage')
        for field in relations:
            if getattr(self, f'{field}_id', None) and getattr(self, field).organization_id != self.organization_id:
                raise ValidationError({field: 'Related record must belong to the same tenant.'})
        if self.to_stage_id and self.pipeline_id and self.to_stage.pipeline_id != self.pipeline_id:
            raise ValidationError({'to_stage': 'Stage history pipeline does not match its destination stage.'})
        super().save(*args, **kwargs)


class DealLineItem(TenantModel):
    class DiscountType(models.TextChoices):
        NONE = 'none', 'None'
        FIXED = 'fixed', 'Fixed'
        PERCENT = 'percent', 'Percentage'

    deal = models.ForeignKey(Deal, on_delete=models.CASCADE, related_name='line_items')
    product = models.ForeignKey(Product, null=True, blank=True, on_delete=models.PROTECT, related_name='deal_line_items')
    name_snapshot = models.CharField(max_length=255)
    sku_snapshot = models.CharField(max_length=100, blank=True)
    quantity = models.DecimalField(max_digits=14, decimal_places=3, validators=[MinValueValidator(Decimal('0.001'))])
    unit_price = models.DecimalField(max_digits=18, decimal_places=2, validators=[money_min])
    discount_type = models.CharField(max_length=12, choices=DiscountType.choices, default=DiscountType.NONE)
    discount_value = models.DecimalField(max_digits=18, decimal_places=2, default=0, validators=[money_min])
    tax_rate = models.DecimalField(
        max_digits=7, decimal_places=4, default=0, validators=[MinValueValidator(0), MaxValueValidator(100)]
    )
    line_total = models.DecimalField(max_digits=18, decimal_places=2, default=0, validators=[money_min])
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['position', 'id']
        constraints = [
            models.CheckConstraint(condition=Q(quantity__gt=0), name='line_item_quantity_positive'),
            models.CheckConstraint(condition=Q(unit_price__gte=0), name='line_item_unit_price_non_negative'),
            models.CheckConstraint(condition=Q(discount_value__gte=0), name='line_item_discount_non_negative'),
            models.CheckConstraint(
                condition=~Q(discount_type='percent') | Q(discount_value__lte=100),
                name='line_item_percent_discount_valid',
            ),
            models.CheckConstraint(condition=Q(line_total__gte=0), name='line_item_total_non_negative'),
        ]
        indexes = [models.Index(fields=['organization', 'deal', 'position'])]

    def calculate_total(self):
        subtotal = self.quantity * self.unit_price
        if self.discount_type == self.DiscountType.PERCENT:
            if self.discount_value > 100:
                raise ValidationError({'discount_value': 'Percentage discount cannot exceed 100.'})
            discount = subtotal * self.discount_value / Decimal('100')
        elif self.discount_type == self.DiscountType.FIXED:
            discount = self.discount_value
        else:
            discount = Decimal('0')
        discounted = subtotal - discount
        if discounted < 0:
            raise ValidationError({'discount_value': 'Discount cannot make the line total negative.'})
        taxed = discounted * (Decimal('1') + self.tax_rate / Decimal('100'))
        return taxed.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    def save(self, *args, **kwargs):
        if self.deal_id and self.organization_id and self.deal.organization_id != self.organization_id:
            raise ValidationError({'deal': 'Deal must belong to the same tenant.'})
        if self.product_id and self.product.organization_id != self.organization_id:
            raise ValidationError({'product': 'Product must belong to the same tenant.'})
        self.line_total = self.calculate_total()
        super().save(*args, **kwargs)

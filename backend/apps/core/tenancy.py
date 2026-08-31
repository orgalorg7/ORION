from django.core.exceptions import ValidationError


def validate_customer_tenant_relations(instance):
    """Defence-in-depth for writes that bypass DRF related fields."""

    if not instance.organization_id:
        raise ValidationError({'organization': 'A tenant is required.'})
    for field in ('company', 'contact', 'team', 'source_record'):
        related_id = getattr(instance, f'{field}_id', None)
        if related_id is None:
            continue
        related = getattr(instance, field)
        if related.organization_id != instance.organization_id:
            raise ValidationError({field: 'Related records must belong to the same tenant.'})
    owner_id = getattr(instance, 'owner_id', None)
    if owner_id is not None:
        from apps.organizations.models import Membership

        if not Membership.objects.filter(
            organization_id=instance.organization_id, user_id=owner_id, is_active=True
        ).exists():
            raise ValidationError({'owner': 'Owner must be an active member of the same tenant.'})

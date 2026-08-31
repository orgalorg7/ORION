from .models import AuditLog, DomainEvent


SENSITIVE_FIELDS = {'password', 'token', 'secret', 'credentials', 'access_token', 'refresh_token'}


def _sensitive_key(key):
    normalized = str(key).casefold()
    return any(token in normalized for token in SENSITIVE_FIELDS)


def _safe_mapping(value):
    if not isinstance(value, dict):
        return {}
    def scrub(item):
        if isinstance(item, dict):
            return {
                str(key): scrub(nested)
                for key, nested in list(item.items())[:100]
                if not _sensitive_key(key)
            }
        if isinstance(item, (list, tuple)):
            return [scrub(nested) for nested in item[:50]]
        if isinstance(item, str) and len(item) > 1000:
            return item[:1000] + '…'
        if item is not None and not isinstance(item, (str, int, float, bool)):
            return item.isoformat() if hasattr(item, 'isoformat') else str(item)
        return item

    return scrub(value)


def record_event(*, organization, actor, event_type, instance, metadata=None, field_diff=None, audit=True):
    object_type = instance._meta.model_name
    safe_metadata = _safe_mapping(metadata or {})
    safe_diff = _safe_mapping(field_diff or {})
    event = DomainEvent.objects.create(
        organization=organization,
        created_by=actor,
        updated_by=actor,
        actor=actor,
        object_type=object_type,
        object_id=instance.pk,
        event_type=event_type,
        metadata=safe_metadata,
        field_diff=safe_diff,
    )
    if audit:
        AuditLog.objects.create(
            organization=organization,
            created_by=actor,
            updated_by=actor,
            actor=actor,
            action=event_type,
            entity_type=object_type,
            entity_id=instance.pk,
            diff=safe_diff,
        )
    return event

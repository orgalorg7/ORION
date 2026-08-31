from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone
from rest_framework import serializers

from .models import BusinessHoursPolicy
from .services import validate_timezone_name


def add_business_minutes(start, minutes, policy: BusinessHoursPolicy):
    """Calculate a deadline in the policy timezone without flattening business time."""
    if not timezone.is_aware(start):
        raise serializers.ValidationError('SLA start must be timezone-aware.')
    if minutes < 0 or minutes > 525600:
        raise serializers.ValidationError('SLA duration must be from 0 to 525,600 minutes.')
    validate_timezone_name(policy.timezone)
    zone = ZoneInfo(policy.timezone)
    holidays = set(policy.holidays.values_list('date', flat=True))
    workdays = set(policy.workdays)
    current = start.astimezone(zone)
    remaining = int(minutes)

    def next_open(value):
        cursor = value
        for _ in range(370):
            if cursor.weekday() in workdays and cursor.date() not in holidays:
                opening = datetime.combine(cursor.date(), policy.opens_at, tzinfo=zone)
                closing = datetime.combine(cursor.date(), policy.closes_at, tzinfo=zone)
                if cursor < opening:
                    return opening
                if cursor < closing:
                    return cursor
            next_date = cursor.date() + timedelta(days=1)
            cursor = datetime.combine(next_date, policy.opens_at, tzinfo=zone)
        raise serializers.ValidationError('Business-hours policy has no reachable working day.')

    current = next_open(current)
    while remaining:
        closing = datetime.combine(current.date(), policy.closes_at, tzinfo=zone)
        available = max(0, int((closing - current).total_seconds() // 60))
        if remaining <= available:
            current += timedelta(minutes=remaining)
            remaining = 0
        else:
            remaining -= available
            current = next_open(datetime.combine(
                current.date() + timedelta(days=1), policy.opens_at, tzinfo=zone
            ))
    return current.astimezone(ZoneInfo('UTC'))

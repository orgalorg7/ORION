"""Canonical identity normalization used by every customer object.

Original values stay on domain records; normalized values are separate and indexed.
"""

import re
import unicodedata
from urllib.parse import urlsplit

import phonenumbers
from django.core.exceptions import ValidationError
from django.core.validators import EmailValidator, URLValidator


_EMAIL_VALIDATOR = EmailValidator()
_URL_VALIDATOR = URLValidator(schemes=('http', 'https'))
_SPACE_RE = re.compile(r'\s+')


def normalize_email(value: str | None) -> str:
    value = (value or '').strip()
    if not value:
        return ''
    normalized = value.casefold()
    _EMAIL_VALIDATOR(normalized)
    return normalized


def normalize_phone(value: str | None, country: str | None = None) -> str:
    value = (value or '').strip()
    if not value:
        return ''
    region = (country or '').strip().upper() or None
    try:
        parsed = phonenumbers.parse(value, region)
    except phonenumbers.NumberParseException as exc:
        raise ValidationError('Enter a valid phone number, including country code when needed.') from exc
    if not phonenumbers.is_possible_number(parsed) or not phonenumbers.is_valid_number(parsed):
        raise ValidationError('Enter a valid phone number, including country code when needed.')
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)


def normalize_domain(value: str | None) -> str:
    value = (value or '').strip()
    if not value:
        return ''
    candidate = value if '://' in value else f'https://{value}'
    try:
        _URL_VALIDATOR(candidate)
    except ValidationError as exc:
        raise ValidationError('Enter a valid domain or website URL.') from exc
    parsed = urlsplit(candidate)
    host = (parsed.hostname or '').rstrip('.').casefold()
    if host.startswith('www.'):
        host = host[4:]
    if not host or '.' not in host:
        raise ValidationError('Enter a valid domain or website URL.')
    # Keep subdomains distinct; only the conventional www alias is removed.
    return host.encode('idna').decode('ascii')


def normalize_name(value: str | None) -> str:
    value = unicodedata.normalize('NFKC', (value or '').strip())
    return _SPACE_RE.sub(' ', value).casefold()


def normalize_key(value: str | None) -> str:
    value = normalize_name(value)
    value = re.sub(r'[^\w\-]+', '_', value, flags=re.UNICODE).strip('_')
    return value

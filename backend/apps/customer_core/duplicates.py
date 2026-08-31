from difflib import SequenceMatcher

from django.db.models import Q
from rest_framework.exceptions import APIException

from apps.contacts.models import Company, Contact
from apps.core.normalization import normalize_domain, normalize_email, normalize_name, normalize_phone
from apps.leads.models import Lead


class DuplicateConflict(APIException):
    status_code = 409
    default_code = 'duplicate_candidates'

    def __init__(self, candidates):
        super().__init__({
            'detail': 'Possible duplicates must be reviewed before conversion.',
            'duplicate_candidates': candidates,
        })


class DuplicateDetectionService:
    """Index-first candidate generation with a bounded in-process fuzzy seam."""

    MAX_FUZZY_CANDIDATES = 50

    @classmethod
    def check(cls, *, organization, target_type, data, exclude_id=None):
        if target_type == 'company':
            return cls._companies(organization, data, exclude_id)
        return cls._people(organization, data, exclude_id)

    @classmethod
    def _people(cls, organization, data, exclude_id):
        email = normalize_email(data.get('email') or data.get('primary_email'))
        phone = normalize_phone(data.get('phone') or data.get('primary_phone'), data.get('country'))
        name = normalize_name(data.get('display_name') or f"{data.get('first_name', '')} {data.get('last_name', '')}")
        company_id = data.get('company') or data.get('company_id')
        company_name = normalize_name(data.get('company_name'))
        city = normalize_name(data.get('city'))
        candidates = {}
        for model, candidate_type in ((Lead, 'lead'), (Contact, 'contact')):
            exact_q = Q()
            if email:
                exact_q |= Q(normalized_email=email)
            if phone:
                exact_q |= Q(normalized_phone=phone)
            if not exact_q:
                continue
            queryset = model.objects.filter(organization=organization).filter(exact_q)
            if exclude_id and candidate_type == data.get('candidate_type', target_type):
                queryset = queryset.exclude(pk=exclude_id)
            for item in queryset[: cls.MAX_FUZZY_CANDIDATES]:
                reasons = []
                if email and item.normalized_email == email:
                    reasons.append('same_email')
                if phone and item.normalized_phone == phone:
                    reasons.append('same_phone')
                score = 0.99 if len(reasons) == 2 else 0.96
                candidates[(candidate_type, item.pk)] = cls._result(item, candidate_type, score, reasons)

        if name:
            for model, candidate_type in ((Lead, 'lead'), (Contact, 'contact')):
                query = model.objects.filter(organization=organization, normalized_name__startswith=name[:4])
                if exclude_id and candidate_type == data.get('candidate_type', target_type):
                    query = query.exclude(pk=exclude_id)
                for item in query.select_related('company')[: cls.MAX_FUZZY_CANDIDATES]:
                    key = (candidate_type, item.pk)
                    if key in candidates:
                        continue
                    similarity = SequenceMatcher(None, name, item.normalized_name).ratio()
                    same_company = bool(
                        (company_id and str(getattr(item, 'company_id', None)) == str(company_id))
                        or (company_name and normalize_name(getattr(item, 'company_name', '')) == company_name)
                    )
                    same_city = bool(city and normalize_name(getattr(item, 'city', '')) == city)
                    reasons = []
                    score = 0.0
                    if similarity >= 0.98 and same_company:
                        score, reasons = 0.88, ['same_name', 'same_company']
                    elif similarity >= 0.82 and (same_company or same_city):
                        score, reasons = 0.62, ['similar_name']
                        reasons.append('same_company' if same_company else 'same_city')
                    if reasons:
                        candidates[key] = cls._result(item, candidate_type, score, reasons)
        return sorted(candidates.values(), key=lambda item: (-item['confidence_score'], item['candidate_type'], item['candidate_id']))

    @classmethod
    def _companies(cls, organization, data, exclude_id):
        domain = normalize_domain(data.get('domain') or data.get('website'))
        name = normalize_name(data.get('name'))
        phone = normalize_phone(data.get('primary_phone') or data.get('phone'), data.get('country'))
        city = normalize_name(data.get('city'))
        query = Company.objects.filter(organization=organization)
        if exclude_id:
            query = query.exclude(pk=exclude_id)
        candidates = {}
        if domain:
            for item in query.filter(normalized_domain=domain)[: cls.MAX_FUZZY_CANDIDATES]:
                candidates[item.pk] = cls._result(item, 'company', 0.98, ['same_domain'])
        if name:
            for item in query.filter(normalized_name__startswith=name[:4])[: cls.MAX_FUZZY_CANDIDATES]:
                if item.pk in candidates:
                    continue
                similarity = SequenceMatcher(None, name, item.normalized_name).ratio()
                same_phone = bool(phone and phone == item.normalized_phone)
                same_city = bool(city and city == normalize_name(item.city))
                if similarity >= 0.98 and same_phone:
                    candidates[item.pk] = cls._result(item, 'company', 0.9, ['same_name', 'same_phone'])
                elif similarity >= 0.82 and same_city:
                    candidates[item.pk] = cls._result(item, 'company', 0.64, ['similar_name', 'same_city'])
        return sorted(candidates.values(), key=lambda item: (-item['confidence_score'], item['candidate_id']))

    @staticmethod
    def _result(instance, candidate_type, score, reasons):
        return {
            'candidate_id': instance.pk,
            'candidate_type': candidate_type,
            'display_name': str(instance),
            'confidence_score': score,
            'match_reasons': reasons,
        }

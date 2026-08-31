from functools import reduce
from operator import and_, or_

from django.db.models import Q
from rest_framework.filters import OrderingFilter, SearchFilter

from .normalization import normalize_domain, normalize_email, normalize_name, normalize_phone


class NormalizedSearchFilter(SearchFilter):
    """DRF search semantics plus canonical identity forms for customer records."""

    def filter_queryset(self, request, queryset, view):
        search_fields = self.get_search_fields(view, request)
        search_terms = self.get_search_terms(request)
        if not search_fields or not search_terms:
            return queryset
        conditions = []
        for term in search_terms:
            term_queries = [Q(**{f'{field.lstrip("^=@$")}__icontains': term}) for field in search_fields]
            normalized = {normalize_name(term)}
            for normalizer in (normalize_email, normalize_phone, normalize_domain):
                try:
                    value = normalizer(term)
                    if value:
                        normalized.add(value)
                except Exception:
                    pass
            for field in search_fields:
                bare = field.lstrip('^=@$')
                if any(token in bare for token in ('normalized_', 'email', 'phone', 'domain')):
                    term_queries.extend(Q(**{f'{bare}__icontains': value}) for value in normalized if value)
            conditions.append(reduce(or_, term_queries))
        return queryset.filter(reduce(and_, conditions)).distinct()


class StableOrderingFilter(OrderingFilter):
    def get_ordering(self, request, queryset, view):
        ordering = super().get_ordering(request, queryset, view)
        if ordering and all(field.lstrip('-') not in ('id', 'pk') for field in ordering):
            ordering = [*ordering, '-id']
        return ordering

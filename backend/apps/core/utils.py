def get_membership(request):
    """Resolve the active membership (and therefore organization) for a request.

    The organization can be selected explicitly with the ``X-Organization``
    header (organization id); otherwise the user's first active membership is
    used. The result is cached on the request object.
    """
    if hasattr(request, '_cached_membership'):
        return request._cached_membership

    membership = None
    user = getattr(request, 'user', None)
    if user is not None and user.is_authenticated:
        from apps.organizations.models import Membership

        qs = Membership.objects.filter(user=user, is_active=True).select_related('organization')
        org_id = request.headers.get('X-Organization')
        if org_id:
            membership = qs.filter(organization_id=org_id).first()
        else:
            membership = qs.order_by('id').first()

    request._cached_membership = membership
    return membership

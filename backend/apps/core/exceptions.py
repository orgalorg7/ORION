from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from rest_framework.response import Response
from rest_framework.views import exception_handler


def api_exception_handler(exc, context):
    if isinstance(exc, DjangoValidationError):
        detail = getattr(exc, 'message_dict', None) or {'detail': exc.messages}
        return Response(detail, status=400)
    if isinstance(exc, IntegrityError):
        return Response({'detail': 'The request conflicts with an existing record.'}, status=409)
    return exception_handler(exc, context)

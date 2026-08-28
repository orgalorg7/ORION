from django.contrib import admin

from .models import Invitation, Membership, Organization, Plan, Subscription

admin.site.register(Organization)
admin.site.register(Membership)
admin.site.register(Plan)
admin.site.register(Subscription)
admin.site.register(Invitation)

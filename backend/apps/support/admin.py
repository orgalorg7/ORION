from django.contrib import admin

from .models import Ticket, TicketComment


@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ['number', 'subject', 'status', 'priority', 'category', 'assigned_to', 'organization']
    search_fields = ['subject', 'description']
    list_filter = ['organization', 'status', 'priority', 'category']


@admin.register(TicketComment)
class TicketCommentAdmin(admin.ModelAdmin):
    list_display = ['ticket', 'author', 'is_internal', 'created_at']
    list_filter = ['is_internal']

from django.contrib import admin

from .models import (
    Activity,
    ActivityAttendee,
    ActivityHistory,
    ActivityOutcomeDefinition,
    ActivityRecurrenceSeries,
    ActivityReminder,
    BusinessHoursPolicy,
    Note,
)


@admin.register(Activity)
class ActivityAdmin(admin.ModelAdmin):
    list_display = ['title', 'type', 'status', 'priority', 'due_at', 'assigned_to', 'organization']
    search_fields = ['title', 'description']
    list_filter = ['type', 'status', 'priority', 'organization']
    raw_id_fields = ['assigned_to', 'contact', 'company', 'deal', 'lead']


admin.site.register(ActivityAttendee)
admin.site.register(ActivityHistory)
admin.site.register(ActivityOutcomeDefinition)
admin.site.register(ActivityRecurrenceSeries)
admin.site.register(ActivityReminder)
admin.site.register(BusinessHoursPolicy)


@admin.register(Note)
class NoteAdmin(admin.ModelAdmin):
    list_display = ['__str__', 'author', 'organization', 'created_at']
    search_fields = ['body']
    list_filter = ['organization']

from django.contrib import admin

from .models import Activity, Note


@admin.register(Activity)
class ActivityAdmin(admin.ModelAdmin):
    list_display = ['title', 'type', 'due_at', 'completed', 'assigned_to', 'organization']
    search_fields = ['title', 'description']
    list_filter = ['type', 'completed', 'organization']


@admin.register(Note)
class NoteAdmin(admin.ModelAdmin):
    list_display = ['__str__', 'author', 'organization', 'created_at']
    search_fields = ['body']
    list_filter = ['organization']

from django.contrib import admin

from .models import Deal, Pipeline, Stage


@admin.register(Pipeline)
class PipelineAdmin(admin.ModelAdmin):
    list_display = ['name', 'is_default', 'organization']
    search_fields = ['name']
    list_filter = ['organization']


@admin.register(Stage)
class StageAdmin(admin.ModelAdmin):
    list_display = ['name', 'pipeline', 'order', 'probability', 'organization']
    search_fields = ['name']
    list_filter = ['organization']


@admin.register(Deal)
class DealAdmin(admin.ModelAdmin):
    list_display = ['title', 'value', 'currency', 'pipeline', 'stage', 'status', 'organization']
    search_fields = ['title']
    list_filter = ['organization', 'status']

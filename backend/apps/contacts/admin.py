from django.contrib import admin

from .models import Company, Contact, Tag


@admin.register(Contact)
class ContactAdmin(admin.ModelAdmin):
    list_display = ['first_name', 'last_name', 'email', 'company', 'organization']
    search_fields = ['first_name', 'last_name', 'email']
    list_filter = ['organization']


@admin.register(Company)
class CompanyAdmin(admin.ModelAdmin):
    list_display = ['name', 'industry', 'city', 'organization']
    search_fields = ['name']
    list_filter = ['organization']


admin.site.register(Tag)

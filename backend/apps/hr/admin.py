from django.contrib import admin

from .models import Department, Employee


@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ['name', 'organization']
    search_fields = ['name']
    list_filter = ['organization']


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = ['first_name', 'last_name', 'email', 'department', 'status', 'organization']
    search_fields = ['first_name', 'last_name', 'email']
    list_filter = ['organization', 'status', 'employment_type']
